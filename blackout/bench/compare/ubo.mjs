// uBlock Origin's static network filtering engine, measured the way
// blackout-bench measures Blackout's, for a like-for-like comparison:
//
//   npm install
//   node --expose-gc ubo.mjs <lists-dir> <requests.tsv> <public_suffix_list.dat> [decisions-out]
//
// The decisions file has one 0/1 line per request, in the same order as the
// file blackout-bench writes with BLACKOUT_DECISIONS.
import fs from "fs";
import path from "path";
import {
  StaticNetFilteringEngine,
  pslInit,
  enableWASM,
} from "@gorhill/ubo-core";

const [dir, requestsFile, pslFile, decisionsFile] = process.argv.slice(2);
const lists = fs
  .readdirSync(dir)
  .filter(f => f.endsWith(".txt"))
  .sort()
  .map(f => ({ name: f, raw: fs.readFileSync(path.join(dir, f), "utf8") }));
const requests = fs
  .readFileSync(requestsFile, "utf8")
  .split("\n")
  .filter(Boolean)
  .map(line => {
    const [url, originURL, type] = line.split("\t");
    return { url, originURL, type };
  });

// The package's bundled public suffix list does not load (every subdomain then
// looks third-party), so give it the real one. uBlock Origin uses WASM in
// Firefox, so it gets it here too.
pslInit(fs.readFileSync(pslFile, "utf8"));
if (!(await enableWASM())) {
  throw new Error("WASM unavailable");
}

const memory = () => {
  const m = process.memoryUsage();
  return m.heapUsed + m.arrayBuffers + m.external;
};
global.gc();
const before = memory();
let t = performance.now();
const snfe = await StaticNetFilteringEngine.create({ noPSL: true });
await snfe.useLists(lists);
console.log(
  `cold start (parse lists): ${(performance.now() - t).toFixed(0)} ms`
);
lists.length = 0;
global.gc();
console.log(
  `engine memory (JS heap and buffers, at least): ${((memory() - before) / 1024).toFixed(0)} KB`
);

const selfie = await snfe.serialize();
t = performance.now();
await snfe.deserialize(selfie);
console.log(
  `warm start (load selfie): ${(performance.now() - t).toFixed(0)} ms`
);

// One warm-up pass for the JIT, then the timed passes.
let decisions = requests.map(r => snfe.matchRequest(r) === 1);
const rounds = 5;
t = performance.now();
for (let i = 0; i < rounds; i++) {
  decisions = requests.map(r => snfe.matchRequest(r) === 1);
}
const us = ((performance.now() - t) * 1e3) / (rounds * requests.length);
console.log(
  `network check: ${us.toFixed(2)} us per request (${decisions.filter(Boolean).length} of ${requests.length} blocked)`
);
if (decisionsFile) {
  fs.writeFileSync(
    decisionsFile,
    decisions.map(d => (d ? "1\n" : "0\n")).join("")
  );
}
