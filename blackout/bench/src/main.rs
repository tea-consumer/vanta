//! Measures Blackout's engine on real filter lists.
//!
//!     cargo run --release -- <lists-dir> [requests.tsv]
//!
//! `<lists-dir>` holds the list files (`*.txt`), as Blackout keeps them in the
//! profile. `requests.tsv` is optional: one `url<TAB>page-url<TAB>type` per
//! line; without it a synthetic set built from the lists' own hosts is used.
//! With `BLACKOUT_DECISIONS=<file>` set, writes one 0/1 block decision per
//! request to that file.

use adblock as filter_engine;

#[path = "../../gecko/toolkit/components/content-classifier/content_classifier_engine/src/blackout.rs"]
mod blackout;

use filter_engine::request::Request;
use std::path::Path;
use std::time::Instant;

fn rss_kb() -> u64 {
    // Hand freed memory back first, so this counts what is actually in use.
    #[cfg(target_os = "linux")]
    unsafe {
        extern "C" {
            fn malloc_trim(pad: usize) -> i32;
        }
        malloc_trim(0);
    }
    std::fs::read_to_string("/proc/self/statm")
        .ok()
        .and_then(|s| s.split_whitespace().nth(1)?.parse::<u64>().ok())
        .map_or(0, |pages| pages * 4)
}

fn synthetic_requests(dir: &Path) -> Vec<(String, String, String)> {
    let pages = [
        "https://www.nytimes.com/",
        "https://www.theverge.com/",
        "https://www.reddit.com/",
    ];
    let types = [
        "script",
        "image",
        "xmlhttprequest",
        "subdocument",
        "stylesheet",
    ];
    let easylist = std::fs::read_to_string(dir.join("easylist.txt")).unwrap_or_default();
    let mut out = Vec::new();
    let hosts = easylist
        .lines()
        .filter_map(|l| l.strip_prefix("||")?.strip_suffix('^'))
        .filter(|h| {
            h.bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'.' || c == b'-')
        })
        .take(2000);
    for (i, h) in hosts.enumerate() {
        out.push((
            format!("https://{h}/tag/js/gpt.js?id={i}"),
            pages[i % 3].into(),
            types[i % 5].into(),
        ));
    }
    let benign = [
        "cdn.jsdelivr.net/npm/react@18/umd/react.production.min.js",
        "fonts.gstatic.com/s/inter/v12/abc.woff2",
        "www.nytimes.com/vi-assets/static-assets/main-123.js",
        "static01.nyt.com/images/2026/10/13/photo.jpg",
        "www.theverge.com/_next/static/chunks/app.js",
        "www.redditstatic.com/shreddit/en-US/app.js",
        "ajax.googleapis.com/ajax/libs/jquery/3.7.1/jquery.min.js",
        "upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg",
        "github.githubassets.com/assets/app.js",
    ];
    for i in 0..2000 {
        out.push((
            format!("https://{}?v={i}", benign[i % benign.len()]),
            pages[i % 3].into(),
            types[i % 5].into(),
        ));
    }
    out
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let dir = Path::new(
        args.get(1)
            .expect("usage: blackout-bench <lists-dir> [requests.tsv]"),
    );
    let cache = std::env::temp_dir().join("blackout-bench-engine.dat");
    let _ = std::fs::remove_file(&cache);

    let t = Instant::now();
    let engine =
        blackout::engine_from_list_dir(dir, &cache).expect("no *.txt lists in that folder");
    println!(
        "cold start (parse lists, write cache): {:.0} ms",
        t.elapsed().as_secs_f64() * 1e3
    );
    drop(engine);

    let rss0 = rss_kb();
    let t = Instant::now();
    let engine = blackout::engine_from_list_dir(dir, &cache).unwrap();
    println!(
        "warm start (load cache):               {:.0} ms",
        t.elapsed().as_secs_f64() * 1e3
    );
    println!(
        "engine cache size:                     {} KB",
        std::fs::metadata(&cache).map_or(0, |m| m.len() / 1024)
    );
    println!(
        "engine memory (loaded from cache):     {} KB",
        rss_kb().saturating_sub(rss0)
    );

    let requests = match args.get(2) {
        Some(path) => std::fs::read_to_string(path)
            .unwrap()
            .lines()
            .filter_map(|l| {
                let mut f = l.split('\t');
                Some((f.next()?.into(), f.next()?.into(), f.next()?.into()))
            })
            .collect(),
        None => synthetic_requests(dir),
    };
    // Gecko hands the engine hosts it already parsed and asks only whether to
    // block (see content_classifier_engine_check_network_request_preparsed),
    // so time exactly that.
    // A request that does not parse stays in as "not blocked", so decisions
    // line up with the requests file.
    let preparsed: Vec<_> = requests
        .iter()
        .map(|(u, s, ty)| {
            let r = Request::new(u, s, ty).ok()?;
            let source = s.split("://").nth(1)?.split(['/', ':', '?']).next()?;
            Some((u, r.hostname, source.to_string(), ty, r.is_third_party))
        })
        .collect();
    let rounds = 5;
    let mut decisions = Vec::new();
    let t = Instant::now();
    for _ in 0..rounds {
        decisions = preparsed
            .iter()
            .map(|parsed| {
                parsed
                    .as_ref()
                    .map_or(false, |(url, host, source, ty, third_party)| {
                        let request = Request::preparsed(url, host, source, ty, *third_party);
                        engine
                            .check_network_request_subset(&request, false, false)
                            .matched
                    })
            })
            .collect();
    }
    let ns = t.elapsed().as_secs_f64() * 1e9 / (rounds * preparsed.len()) as f64;
    println!(
        "network check:                         {:.2} us per request ({} of {} blocked)",
        ns / 1e3,
        decisions.iter().filter(|&&d| d).count(),
        preparsed.len()
    );
    // One 0/1 line per request, to compare with another blocker.
    if let Ok(path) = std::env::var("BLACKOUT_DECISIONS") {
        let lines: String = decisions
            .iter()
            .map(|&d| if d { "1\n" } else { "0\n" })
            .collect();
        std::fs::write(path, lines).unwrap();
    }

    let generic = blackout::generic_selectors(&engine);
    for url in [
        "https://www.nytimes.com/",
        "https://www.youtube.com/watch?v=1",
        "https://browserbench.org/Speedometer3.1/",
    ] {
        let t = Instant::now();
        let specific = blackout::cosmetic_css(&engine, url, Some(&generic));
        let us = t.elapsed().as_secs_f64() * 1e6;
        let all = blackout::cosmetic_css(&engine, url, None);
        println!(
            "element hiding {url}: {} site rules ({} bytes, {:.0} us), {} with generic rules",
            specific.lines().count(),
            specific.len(),
            us,
            all.lines().count()
        );
    }

    // Generic rules by class and id, for a page that uses a few common ones.
    let classes = [
        "header",
        "nav",
        "article",
        "ad-slot",
        "adsbygoogle",
        "banner-adverts",
    ];
    let ids = ["main", "ad_top"];
    let t = Instant::now();
    let css = blackout::class_id_css(
        &engine,
        "https://news.example/",
        classes.into_iter(),
        ids.into_iter(),
    );
    println!(
        "generic hiding for {} classes and {} ids: {} rules ({:.0} us)",
        classes.len(),
        ids.len(),
        css.lines().count(),
        t.elapsed().as_secs_f64() * 1e6
    );
}
