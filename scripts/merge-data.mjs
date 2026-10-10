#!/usr/bin/env node
// data/seoul.json + data/gyeonggi.json → data/toilets.json (앱이 읽는 파일)
//   node scripts/merge-data.mjs
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PARTS = ["data/seoul.json", "data/gyeonggi.json"];

export async function mergeAll() {
  const toilets = [], sources = [], dates = [];
  for (const p of PARTS) {
    try {
      const d = JSON.parse(await readFile(path.join(ROOT, p), "utf8"));
      toilets.push(...d.toilets);
      sources.push({ provider: d.meta.provider, dataset: d.meta.dataset, count: d.toilets.length, referenceDate: d.meta.referenceDate, page: d.meta.sourcePages?.[0] });
      if (d.meta.referenceDate) dates.push(d.meta.referenceDate);
    } catch { /* 아직 없는 파일은 건너뜀 */ }
  }
  if (!toilets.length) throw new Error("data/seoul.json 또는 data/gyeonggi.json이 필요해요.");
  const meta = {
    dataset: sources.map((s) => s.dataset).join(" + "),
    sources,
    sourcePages: sources.map((s) => s.page).filter(Boolean),
    count: toilets.length,
    referenceDate: dates.sort().at(-1),
    generatedAt: new Date().toISOString(),
  };
  await writeFile(path.join(ROOT, "data/toilets.json"), JSON.stringify({ meta, toilets }));
  console.log(`합치기 완료: ${sources.map((s) => `${s.provider} ${s.count}`).join(", ")} → data/toilets.json ${toilets.length}곳`);
}

if (import.meta.url === `file://${process.argv[1]}`) mergeAll().catch((e) => { console.error(e.message); process.exit(1); });
