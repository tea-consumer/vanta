#!/usr/bin/env node
// Generates Vanta cookie banner site rules by visiting popular sites.
//
// For each site it looks for a visible cookie banner with a reject button
// (see detect.cjs), writes a Firefox click rule for it, then loads the site
// again in a fresh profile, applies the rule the way Vanta does and keeps it
// only if the banner goes away. Sites already handled by a working global or
// Mozilla rule are skipped.
//
// Banners mostly show to European visitors, so run this from an EU/EEA IP.
//
//   npm install            # in this folder; installs playwright
//   npx playwright install chromium
//   node crawl.mjs --top 10000 --concurrency 8 --out out
//   node crawl.mjs --sites example.com,example.org --out out
//   (--rules <path> points at vanta-rules.json when run outside the repo)
//
// Output (resumable; rerun the same command to continue, and add --retry to
// also redo sites that ended in an error):
//   out/results.jsonl         one line per site with what happened
//   out/vanta-site-rules.json rules in Firefox's format, ready to copy to
//                             cookiebanners/vanta-site-rules.json

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const { vantaDetectBanner, vantaApplyRule, vantaBannerGone } = require("./detect.cjs");
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--")) acc.push([a.slice(2), all[i + 1]?.startsWith("--") ? true : all[i + 1] ?? true]);
    return acc;
  }, [])
);
const TOP = Number(args.top || 1000);
const CONCURRENCY = Number(args.concurrency || 6);
const OUT = path.resolve(args.out || "out");
const LOCALE = args.locale || "en-GB";
const TZ = args.timezone || "Europe/Oslo";
fs.mkdirSync(OUT, { recursive: true });

async function cached(name, url) {
  const file = path.join(OUT, name);
  if (!fs.existsSync(file)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return file;
}

// --- Public suffix list, for the base domain Firefox keys rules by. -------
const psl = new Set();
const pslWild = new Set();
const pslExc = new Set();
for (const line of fs
  .readFileSync(await cached("public_suffix_list.dat", "https://publicsuffix.org/list/public_suffix_list.dat"), "utf8")
  .split("\n")) {
  const l = line.trim();
  if (!l || l.startsWith("//")) continue;
  if (l.startsWith("!")) pslExc.add(l.slice(1));
  else if (l.startsWith("*.")) pslWild.add(l.slice(2));
  else psl.add(l);
}
function baseDomain(host) {
  const parts = host.toLowerCase().replace(/\.$/, "").split(".");
  for (let i = 0; i < parts.length; i++) {
    const suffix = parts.slice(i).join(".");
    if (pslExc.has(suffix)) return parts.slice(i).join(".");
    const isSuffix = psl.has(suffix) || pslWild.has(parts.slice(i + 1).join("."));
    if (isSuffix) return i === 0 ? host : parts.slice(i - 1).join(".");
  }
  return parts.slice(-2).join(".");
}

// --- Rules we already have. ------------------------------------------------
const mozRules = JSON.parse(
  fs.readFileSync(
    await cached(
      "mozilla-rules.json",
      "https://firefox.settings.services.mozilla.com/v1/buckets/main/collections/cookie-banner-rules-list/changeset?_expected=0"
    ),
    "utf8"
  )
).changes;
const vantaRules = JSON.parse(
  fs.readFileSync(args.rules || path.join(here, "../../cookiebanners/vanta-rules.json"), "utf8")
).data;
const globalRules = new Map();
for (const r of [...mozRules, ...vantaRules]) {
  if (!r.domains?.length && r.click?.presence && r.click?.optOut) globalRules.set(r.id, r.click);
}
// A site rule whose button is a global rule's button only repeats that rule
// (its banner just appeared after the global check gave up).
const globalButtons = [...globalRules.values()].flatMap(c => c.optOut.split(",").map(s => s.trim()));
const repeatsGlobal = optOut => globalButtons.some(b => optOut === b || optOut.endsWith(" " + b));
const mozSiteRules = new Map();
for (const r of mozRules) {
  for (const d of r.domains || []) if (r.click?.optOut || r.cookies?.optOut) mozSiteRules.set(d, r);
}

// --- Site list. ------------------------------------------------------------
let sites;
if (args.sites) {
  sites = String(args.sites).split(",").map(s => s.trim()).filter(Boolean);
} else {
  const zip = await cached("tranco.zip", "https://tranco-list.eu/top-1m.csv.zip");
  const { execFileSync } = await import("node:child_process");
  sites = execFileSync("unzip", ["-p", zip], { maxBuffer: 1 << 26 })
    .toString()
    .split("\n")
    .slice(0, TOP)
    .map(l => l.split(",")[1]?.trim())
    .filter(Boolean);
}

const resultsFile = path.join(OUT, "results.jsonl");
const done = new Set();
if (fs.existsSync(resultsFile)) {
  for (const l of fs.readFileSync(resultsFile, "utf8").split("\n")) {
    if (!l) continue;
    const r = JSON.parse(l);
    if (!(args.retry && r.status === "error")) done.add(r.site);
  }
}
const todo = sites.filter(s => !done.has(s));
console.log(`${sites.length} sites, ${done.size} done, ${todo.length} to go`);

// --- Browser. ----------------------------------------------------------------
let browser = await chromium.launch({ headless: true });
let sinceRestart = 0;
let relaunching = null;

// Chromium sometimes crashes mid-crawl; without this every later site fails
// with "browser has been closed".
async function relaunch() {
  relaunching ||= (async () => {
    const old = browser;
    browser = await chromium.launch({ headless: true });
    sinceRestart = 0;
    setTimeout(() => old.close().catch(() => {}), 60000);
  })().finally(() => (relaunching = null));
  return relaunching;
}

async function newPage() {
  const ctx = await browser.newContext({
    locale: LOCALE,
    timezoneId: TZ,
    viewport: { width: 1366, height: 900 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:158.0) Gecko/20100101 Firefox/158.0",
  });
  await ctx.route("**/*", route => {
    const t = route.request().resourceType();
    return ["image", "media", "font"].includes(t) ? route.abort() : route.continue();
  });
  const page = await ctx.newPage();
  return { ctx, page };
}

async function load(page, site) {
  for (const url of [`https://${site}/`, `https://www.${site}/`]) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForLoadState("load", { timeout: 10000 }).catch(() => {});
      return true;
    } catch {}
  }
  return false;
}

async function evalIn(frame, fn, arg) {
  try {
    return await frame.evaluate(fn, arg);
  } catch {
    return null;
  }
}

// Poll for up to `ms` until fn returns something truthy in some frame.
async function pollFrames(page, ms, fn) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    for (const frame of page.frames()) {
      const r = await fn(frame);
      if (r) return { frame, r };
    }
    await page.waitForTimeout(700);
  }
  return null;
}

async function verify(site, rule, frameHost) {
  const { ctx, page } = await newPage();
  try {
    if (!(await load(page, site))) return "load-failed";
    const target = f =>
      frameHost ? (f !== page.mainFrame() && hostOf(f.url()) === frameHost) : f === page.mainFrame();
    const hit = await pollFrames(page, 9000, async f =>
      target(f) && (await evalIn(f, vantaApplyRule, rule)) === "clicked" ? true : null
    );
    if (!hit) return "rule-did-not-fire";
    const before = baseDomain(hostOf(page.url()));
    await page.waitForTimeout(2500);
    // A "reject" that sends you to another site (a paywall, a login) is not
    // a rejection we want to click automatically.
    if (baseDomain(hostOf(page.url())) !== before) return "navigated-away";
    const frame = page.frames().find(target);
    if (!frame) return "verified"; // the banner iframe was removed
    return (await evalIn(frame, vantaBannerGone, rule)) === false ? "banner-stayed" : "verified";
  } finally {
    await ctx.close().catch(() => {});
  }
}

function hostOf(u) {
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
}

async function processSite(site) {
  const started = Date.now();
  const { ctx, page } = await newPage();
  try {
    if (!(await load(page, site))) return { status: "load-failed" };
    const finalBase = baseDomain(hostOf(page.url()) || site);

    // Already covered by a working global rule?
    const covered = await pollFrames(page, 3000, async f => {
      if (f !== page.mainFrame()) return null;
      for (const [id, click] of globalRules) {
        const r = await evalIn(f, ({ presence, optOut }) => {
          const b = document.querySelector(presence);
          return !!(b && b.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
            document.querySelector(optOut));
        }, click);
        if (r) return id;
      }
      return null;
    });
    if (covered) return { status: "global", id: covered.r, domain: finalBase };

    const found = await pollFrames(page, 6000, async f => {
      const r = await evalIn(f, vantaDetectBanner);
      return r?.kind === "rule" ? r : null;
    });
    if (!found) {
      const other = await evalIn(page.mainFrame(), vantaDetectBanner);
      return { status: other?.kind || "no-banner", detail: other || undefined, domain: finalBase };
    }

    const isChild = found.frame !== page.mainFrame();
    const frameHost = isChild ? hostOf(found.frame.url()) : null;
    const rule = {
      domain: isChild ? baseDomain(frameHost) : finalBase,
      presence: found.r.presence,
      optOut: found.r.optOut,
      rejectText: found.r.rejectText,
      runContext: isChild ? "child" : "top",
    };
    const verdict = await verify(site, rule, frameHost);
    return { status: verdict, rule, ms: Date.now() - started };
  } finally {
    await ctx.close().catch(() => {});
  }
}

const out = fs.createWriteStream(resultsFile, { flags: "a" });
let next = 0;
async function worker() {
  while (next < todo.length) {
    const site = todo[next++];
    let res;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        res = await processSite(site);
        break;
      } catch (e) {
        res = { status: "error", error: String(e).slice(0, 200) };
        if (!browser.isConnected() || /has been closed|Target closed/.test(res.error)) {
          if (relaunching) await relaunching;
          if (!browser.isConnected()) await relaunch();
          continue;
        }
        break;
      }
    }
    out.write(JSON.stringify({ site, ...res }) + "\n");
    if (res.status === "verified") console.log(`✓ ${site}  ${res.rule.optOut}`);
    // Chromium grows over thousands of contexts; recycle it now and then.
    if (++sinceRestart >= 400) await relaunch();
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
out.end();
await browser.close();

// --- Build the rules file from every verified result. --------------------
// The last line for a site wins (a --retry run appends a new one).
const results = [
  ...new Map(
    fs
      .readFileSync(resultsFile, "utf8")
      .split("\n")
      .filter(Boolean)
      .map(l => JSON.parse(l))
      .map(r => [r.site, r])
  ).values(),
];
const groups = new Map();
for (const r of results) {
  if (r.status !== "verified") continue;
  // Mozilla's working site rule wins; ours would only duplicate it.
  if (mozSiteRules.has(r.rule.domain) && r.rule.runContext === "top") continue;
  if (repeatsGlobal(r.rule.optOut)) continue;
  const key = JSON.stringify([r.rule.presence, r.rule.optOut, r.rule.runContext]);
  if (!groups.has(key)) groups.set(key, { ...r.rule, domains: new Set() });
  groups.get(key).domains.add(r.rule.domain);
}
const data = [...groups.values()]
  .map(g => {
    const domains = [...g.domains].sort();
    const click = { presence: g.presence, optOut: g.optOut };
    if (g.runContext !== "top") click.runContext = g.runContext;
    return { id: `vanta-site-${domains[0]}`, domains, click };
  })
  .sort((a, b) => a.id.localeCompare(b.id));
fs.writeFileSync(path.join(OUT, "vanta-site-rules.json"), JSON.stringify({ data }, null, 1) + "\n");

const counts = {};
for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
console.log("results:", counts);
console.log(`rules: ${data.length} covering ${data.reduce((n, r) => n + r.domains.length, 0)} domains`);
