/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

//! Vanta Blackout: the parts of the "blackout" content classifier feature
//! that are not plain rule matching.
//!
//! Blackout's filter lists live as text files in the profile
//! (`<profile>/blackout/lists/*.txt`, kept fresh by Blackout.sys.mjs). Parsing
//! them takes a few hundred milliseconds, so the compiled engine is cached
//! next to them and reloaded from that cache on every start where the lists
//! did not change. Everything here runs on the content classifier's build
//! thread or on the URL classifier thread, never on the main thread.

use std::borrow::Cow;
use std::collections::hash_map::DefaultHasher;
use std::collections::HashSet;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::filter_engine::lists::ParseOptions;
use crate::filter_engine::Engine;

const CACHE_MAGIC: &[u8; 8] = b"VBLKOUT1";
const CACHE_HEADER_LEN: usize = 16;

// A host no filter list names, so its cosmetic resources are exactly the
// generic selectors that apply to every site.
const GENERIC_ONLY_URL: &str = "https://blackout.invalid/";

fn list_files(dir: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = match fs::read_dir(dir) {
        Ok(entries) => entries
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.extension().map_or(false, |ext| ext == "txt"))
            .collect(),
        Err(_) => return Vec::new(),
    };
    files.sort();
    files
}

/// Identifies one exact set of list files. Any change to a list's name, size
/// or modification time, or to this code, invalidates the cached engine.
fn cache_key(files: &[PathBuf]) -> u64 {
    let mut hasher = DefaultHasher::new();
    CACHE_MAGIC.hash(&mut hasher);
    env!("CARGO_PKG_VERSION").hash(&mut hasher);
    for file in files {
        file.file_name().hash(&mut hasher);
        if let Ok(meta) = fs::metadata(file) {
            meta.len().hash(&mut hasher);
            if let Ok(modified) = meta.modified() {
                modified.hash(&mut hasher);
            }
        }
    }
    hasher.finish()
}

fn load_cache(cache: &Path, key: u64) -> Option<Engine> {
    let bytes = fs::read(cache).ok()?;
    if bytes.len() <= CACHE_HEADER_LEN || &bytes[..8] != CACHE_MAGIC {
        return None;
    }
    let stored_key = u64::from_le_bytes(bytes[8..CACHE_HEADER_LEN].try_into().ok()?);
    if stored_key != key {
        return None;
    }
    let mut engine = Engine::default();
    engine.deserialize(&bytes[CACHE_HEADER_LEN..]).ok()?;
    Some(engine)
}

fn store_cache(cache: &Path, key: u64, engine: &Engine) {
    let data = engine.serialize();
    let tmp = cache.with_extension("tmp");
    let written = fs::File::create(&tmp).and_then(|mut f| {
        f.write_all(CACHE_MAGIC)?;
        f.write_all(&key.to_le_bytes())?;
        f.write_all(&data)?;
        f.sync_all()
    });
    // A failed write only costs a rebuild on the next start.
    if written.is_err() || fs::rename(&tmp, cache).is_err() {
        let _ = fs::remove_file(&tmp);
    }
}

/// Builds the Blackout engine from every `*.txt` list in `lists_dir`, using
/// the engine cached at `cache` when the lists have not changed since it was
/// written. Returns `None` when there are no lists yet.
pub fn engine_from_list_dir(lists_dir: &Path, cache: &Path) -> Option<Engine> {
    let files = list_files(lists_dir);
    if files.is_empty() {
        return None;
    }
    let key = cache_key(&files);
    if let Some(engine) = load_cache(cache, key) {
        return Some(engine);
    }

    let texts: Vec<String> = files
        .iter()
        .filter_map(|f| fs::read(f).ok())
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        .collect();
    let mut rules = Vec::new();
    for line in texts.iter().flat_map(|text| preprocess(text)) {
        adapt(line, &mut rules);
    }
    let engine = Engine::from_rules(rules, ParseOptions::default());
    store_cache(cache, key, &engine);
    Some(engine)
}

// The `!#if` conditions that hold for Blackout. uBlock Origin's lists keep
// rules for other browsers and for features this engine lacks (such as HTML
// filtering) behind these; any condition not named here is false.
const TRUE_CONDITIONS: &[&str] = &["env_firefox", "ext_ublock", "cap_user_stylesheet"];

/// Yields the lines of a filter list that apply to Blackout, evaluating
/// uBlock Origin's `!#if <condition>` / `!#else` / `!#endif` blocks. Lists
/// without them pass through unchanged.
pub fn preprocess(text: &str) -> impl Iterator<Item = &str> {
    // One entry per open `!#if`: whether its current branch is active.
    let mut active: Vec<bool> = Vec::new();
    text.lines().filter(move |line| {
        if let Some(condition) = line.strip_prefix("!#if ") {
            let outer = active.last().copied().unwrap_or(true);
            active.push(outer && evaluate(condition));
            return false;
        }
        if line.starts_with("!#else") {
            let outer = active.len() < 2 || active[active.len() - 2];
            if let Some(branch) = active.last_mut() {
                *branch = outer && !*branch;
            }
            return false;
        }
        if line.starts_with("!#endif") {
            active.pop();
            return false;
        }
        active.last().copied().unwrap_or(true)
    })
}

/// Turns one list line into the rules this engine should get, translating
/// the uBlock Origin options it does not understand where that keeps the
/// rule's meaning, and leaving out the ones that would change it.
fn adapt<'a>(line: &'a str, out: &mut Vec<Cow<'a, str>>) {
    if line.is_empty() {
        return;
    }
    let Some(dollar) = network_options_start(line) else {
        out.push(Cow::Borrowed(line));
        return;
    };
    let (pattern, options) = (&line[..dollar], &line[dollar + 1..]);
    let is_exception = line.starts_with("@@");
    let mut kept: Vec<&str> = Vec::new();
    let mut deny_allow = None;
    let mut has_domain = false;
    for option in options.split(',') {
        match option {
            // uBlock Origin's `@@...$redirect-rule` exceptions only switch off
            // a redirect and keep the block underneath. This engine would read
            // them as full exceptions, and Gecko does not redirect anyway.
            o if is_exception && o.starts_with("redirect") => return,
            // Gecko only asks whether to block, so rules that only redirect a
            // request or rewrite its URL would cost time on every request and
            // do nothing. A redirect that also blocks is kept as a block.
            o if o.starts_with("redirect-rule") || o.starts_with("removeparam") => return,
            o if o.starts_with("redirect=") => {}
            // Rules never apply to top-level documents unless they say
            // `$document`, so excluding them changes nothing.
            "~document" | "~doc" => {}
            o if o.starts_with("denyallow=") => deny_allow = Some(&o["denyallow=".len()..]),
            o => {
                has_domain |= o.starts_with("domain=") || o.starts_with("from=");
                kept.push(o);
            }
        }
    }
    if kept.len() == options.split(',').count() {
        out.push(Cow::Borrowed(line));
        return;
    }
    // `rule$denyallow=a|b` blocks everything the rule matches except requests
    // to a and b. Expressed here as the rule plus exceptions for a and b, which
    // is the same thing as long as the rule is limited to some sites.
    if let Some(hosts) = deny_allow {
        if is_exception || !has_domain {
            return;
        }
        let scope: Vec<&str> = kept.iter().copied().filter(|o| *o != "important").collect();
        for host in hosts.split('|') {
            if !host.is_empty() && !host.contains(|c| matches!(c, '~' | '*' | '/' | '^' | '$')) {
                out.push(Cow::Owned(format!("@@||{host}^${}", scope.join(","))));
            }
        }
    }
    out.push(Cow::Owned(if kept.is_empty() {
        pattern.to_string()
    } else {
        format!("{pattern}${}", kept.join(","))
    }));
}

/// Where a network rule's options start, or `None` for comments, cosmetic
/// rules and rules without options.
fn network_options_start(line: &str) -> Option<usize> {
    if line.starts_with('!') || line.starts_with('[') {
        return None;
    }
    if ["##", "#@#", "#?#", "#$#", "#%#"]
        .iter()
        .any(|m| line.contains(m))
    {
        return None;
    }
    line.rfind('$')
}

/// Evaluates a condition made of names, `!`, `&&`, `||` and parentheses.
fn evaluate(condition: &str) -> bool {
    let tokens: Vec<&str> = tokenize(condition);
    let mut pos = 0;
    let value = parse_or(&tokens, &mut pos);
    // A condition that does not parse completely is treated as false.
    value && pos == tokens.len()
}

fn tokenize(condition: &str) -> Vec<&str> {
    let mut tokens = Vec::new();
    let bytes = condition.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b' ' | b'\t' => i += 1,
            b'(' | b')' | b'!' => {
                tokens.push(&condition[i..i + 1]);
                i += 1;
            }
            b'&' | b'|' if bytes.get(i + 1) == Some(&bytes[i]) => {
                tokens.push(&condition[i..i + 2]);
                i += 2;
            }
            _ => {
                let start = i;
                while i < bytes.len() && !b" \t()!&|".contains(&bytes[i]) {
                    i += 1;
                }
                if i == start {
                    // A stray `&` or `|`.
                    tokens.push(&condition[i..i + 1]);
                    i += 1;
                } else {
                    tokens.push(&condition[start..i]);
                }
            }
        }
    }
    tokens
}

fn parse_or(tokens: &[&str], pos: &mut usize) -> bool {
    let mut value = parse_and(tokens, pos);
    while tokens.get(*pos) == Some(&"||") {
        *pos += 1;
        value |= parse_and(tokens, pos);
    }
    value
}

fn parse_and(tokens: &[&str], pos: &mut usize) -> bool {
    let mut value = parse_not(tokens, pos);
    while tokens.get(*pos) == Some(&"&&") {
        *pos += 1;
        value &= parse_not(tokens, pos);
    }
    value
}

fn parse_not(tokens: &[&str], pos: &mut usize) -> bool {
    match tokens.get(*pos) {
        Some(&"!") => {
            *pos += 1;
            !parse_not(tokens, pos)
        }
        Some(&"(") => {
            *pos += 1;
            let value = parse_or(tokens, pos);
            if tokens.get(*pos) == Some(&")") {
                *pos += 1;
            } else {
                *pos = usize::MAX - 1;
            }
            value
        }
        Some(name) if name.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_') => {
            *pos += 1;
            TRUE_CONDITIONS.contains(name)
        }
        _ => {
            *pos = usize::MAX - 1;
            false
        }
    }
}

/// The generic selectors (`##.ad-banner` and the like) every site gets,
/// computed once per engine. Used to leave them out when only site-specific
/// hiding is wanted.
pub fn generic_selectors(engine: &Engine) -> HashSet<String> {
    engine
        .url_cosmetic_resources(GENERIC_ONLY_URL)
        .hide_selectors
}

/// Returns a user style sheet that hides the elements the lists name for
/// `url`. With `generic` set to `None` the sheet also carries the generic
/// selectors that do not target a class or id; otherwise those are left out.
pub fn cosmetic_css(engine: &Engine, url: &str, generic: Option<&HashSet<String>>) -> String {
    let resources = engine.url_cosmetic_resources(url);
    style_sheet(
        resources
            .hide_selectors
            .iter()
            .filter(|s| generic.map_or(true, |g| !g.contains(*s))),
    )
}

/// Returns a user style sheet of the generic rules (`##.ad-slot`,
/// `###banner` and the like) that target any of the CSS `classes` and `ids`
/// found on a page at `url`. Lists hold tens of thousands of these, so pages
/// report what they contain and get only the rules that can apply. Rules the
/// site has exceptions for are left out, and a site that turns generic hiding
/// off gets an empty sheet.
pub fn class_id_css<'a>(
    engine: &Engine,
    url: &str,
    classes: impl Iterator<Item = &'a str>,
    ids: impl Iterator<Item = &'a str>,
) -> String {
    let resources = engine.url_cosmetic_resources(url);
    if resources.generichide {
        return String::new();
    }
    let selectors = engine.hidden_class_id_selectors(classes, ids, &resources.exceptions);
    style_sheet(selectors.iter())
}

/// One rule per selector, so that a selector this engine can parse but the
/// style system cannot only drops itself.
fn style_sheet<'a>(selectors: impl Iterator<Item = &'a String>) -> String {
    let mut selectors: Vec<&String> = selectors.filter(|s| is_safe_selector(s)).collect();
    selectors.sort();

    let mut css = String::with_capacity(selectors.iter().map(|s| s.len() + 26).sum());
    for selector in selectors {
        css.push_str(selector);
        css.push_str("{display:none!important}\n");
    }
    css
}

/// Filter lists are third-party input. A selector must not be able to close
/// its rule and add declarations or at-rules of its own.
fn is_safe_selector(selector: &str) -> bool {
    !selector.is_empty()
        && !selector.starts_with('@')
        && !selector.contains(|c| matches!(c, '{' | '}' | ';' | '\0'))
}

#[cfg(test)]
mod tests {
    use super::preprocess;

    fn kept(text: &str) -> Vec<&str> {
        preprocess(text).collect()
    }

    #[test]
    fn conditions() {
        let list = "a\n!#if env_firefox\nb\n!#else\nc\n!#endif\n!#if !env_firefox\nd\n!#endif\n\
                    !#if env_chromium || (ext_ublock && !env_mobile)\ne\n!#if env_safari\nf\n\
                    !#else\ng\n!#endif\n!#endif\n!#if env_firefox &&\nh\n!#endif\ni";
        assert_eq!(kept(list), ["a", "b", "e", "g", "i"]);
    }

    fn adapted(line: &str) -> Vec<String> {
        let mut out = Vec::new();
        super::adapt(line, &mut out);
        out.into_iter().map(|r| r.into_owned()).collect()
    }

    #[test]
    fn options() {
        let plain = "||example.com/a.js$script,domain=example.org";
        assert_eq!(adapted(plain), [plain]);
        assert_eq!(adapted("example.org##.ad"), ["example.org##.ad"]);
        assert!(
            adapted("@@||example.com/a.js$script,redirect-rule=noop.js,domain=example.org")
                .is_empty()
        );
        assert_eq!(
            adapted("||redirect.example/a.js$script,redirect=noop.js"),
            ["||redirect.example/a.js$script"]
        );
        assert!(adapted("||example.com^$redirect-rule=noop.js").is_empty());
        assert!(adapted("$removeparam=utm_source").is_empty());
        assert_eq!(adapted("/track/*$~document,image"), ["/track/*$image"]);
        assert_eq!(adapted("/track/*$~document"), ["/track/*"]);
        assert_eq!(
            adapted("*$script,3p,denyallow=cdn.example|*.bad,from=site.example"),
            [
                "@@||cdn.example^$script,3p,from=site.example",
                "*$script,3p,from=site.example"
            ]
        );
        assert!(adapted("*$script,3p,denyallow=cdn.example").is_empty());
    }

    #[test]
    fn else_inside_false_block_stays_false() {
        let list = "!#if env_safari\n!#if env_firefox\na\n!#else\nb\n!#endif\n!#endif\nc";
        assert_eq!(kept(list), ["c"]);
    }
}
