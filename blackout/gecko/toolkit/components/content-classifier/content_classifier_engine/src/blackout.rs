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
    let rules = texts
        .iter()
        .flat_map(|text| text.lines())
        .filter(|line| !line.is_empty());
    let engine = Engine::from_rules(rules, ParseOptions::default());
    store_cache(cache, key, &engine);
    Some(engine)
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
/// `url`, one rule per selector so that a selector this engine can parse but
/// the style system cannot only drops itself. With `generic` set to `None`
/// the sheet also carries the generic selectors; otherwise those are left out.
pub fn cosmetic_css(engine: &Engine, url: &str, generic: Option<&HashSet<String>>) -> String {
    let resources = engine.url_cosmetic_resources(url);
    let mut selectors: Vec<&String> = resources
        .hide_selectors
        .iter()
        .filter(|s| generic.map_or(true, |g| !g.contains(*s)))
        .filter(|s| is_safe_selector(s))
        .collect();
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
