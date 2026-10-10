#!/usr/bin/env node
// 서울열린데이터광장 "서울시 공중화장실 위치정보"(OA-22586) CSV → data/toilets.json
//
// 사용법 (Node 20 이상, 외부 패키지 없음)
//   node scripts/seoul-csv-to-json.mjs 서울시_공중화장실_위치정보.csv
//
// 열 이름이 조금 달라도 알아서 찾습니다. 못 찾은 열이 있으면 실제 열 이름을 출력하니
// 그 목록을 알려주시면 맞춰 드립니다. 원본에 없는 항목(비상벨, 기저귀 교환대 등)은 지어내지 않고
// "정보 없음"(null)으로 둡니다.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeAll } from "./merge-data.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = path.join(ROOT, "data/seoul.json");
const SOURCE_PAGE = "https://data.seoul.go.kr/dataList/OA-22586/S/1/datasetView.do";

const text = (v) => (v == null ? "" : String(v).trim());
const normKey = (k) => text(k).replace(/^﻿/, "").replace(/[\s_\-()（）\[\]]/g, "").toLowerCase();

function decode(bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder("utf-8").decode(bytes);
  const utf = new TextDecoder("utf-8").decode(bytes);
  return utf.includes("�") ? new TextDecoder("euc-kr").decode(bytes) : utf;
}

function parseCsv(src) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); if (row.some((x) => x.trim() !== "")) rows.push(row); }
  const [header, ...body] = rows;
  return { header, records: body.map((r) => Object.fromEntries(header.map((h, i) => [normKey(h), r[i] ?? ""]))) };
}

// 열 이름 후보 (앞에 있을수록 우선)
const COLS = {
  name: ["화장실명", "건물명", "명칭", "시설명", "화장실이름", "이름", "name"],
  road: ["도로명주소", "소재지도로명주소", "주소", "도로명", "address"],
  lot: ["지번주소", "소재지지번주소", "지번"],
  id: ["연번", "번호"],
  lat: ["위도", "y좌표", "y", "wgs84위도", "lat", "latitude"],
  lng: ["경도", "x좌표", "x", "wgs84경도", "lng", "lon", "longitude"],
  gu: ["구명칭", "자치구", "자치구명", "구명", "시군구", "구"],
  type: ["유형", "구분", "화장실구분", "설치장소유형", "종류"],
  hours: ["개방시간", "운영시간", "개방시간상세", "이용시간"],
  tel: ["전화번호", "연락처", "관리기관전화번호"],
  org: ["관리기관", "관리기관명", "관리부서", "비고"],
  place: ["소재지", "설치장소"],
  closed: ["소재지용도", "휴무일", "휴관일"],
  stalls: ["화장실현황"],
  extra: ["편의시설기타설비", "편의시설"],
  signs: ["안내표지"],
  wheel: ["장애인화장실현황", "장애인화장실", "장애인용", "장애인대변기", "장애인화장실유무"],
  diaper: ["기저귀교환대", "기저귀교환대설치여부", "기저귀"],
  bell: ["비상벨", "비상벨설치여부"],
  cctv: ["cctv", "입구cctv", "화장실입구cctv설치유무"],
  ref: ["데이터기준일자", "기준일", "수정일"],
};
function findCols(header) {
  const keys = header.map(normKey);
  const out = {};
  for (const [field, cands] of Object.entries(COLS)) {
    const hit = cands.map(normKey).find((c) => keys.includes(c)) ?? cands.map(normKey).find((c) => c.length > 1 && keys.some((k) => k.includes(c)));
    out[field] = hit ? (keys.includes(hit) ? hit : keys.find((k) => k.includes(hit))) : null;
  }
  return out;
}

function yesNo(v) {
  const s = text(v).toUpperCase();
  if (!s) return null;
  if (["Y", "YES", "1", "TRUE", "있음", "유", "O", "설치"].includes(s) || /^[1-9]\d*$/.test(s)) return true;
  if (["N", "NO", "0", "FALSE", "없음", "무", "X", "미설치"].includes(s)) return false;
  return null;
}
function hoursInfo(raw) {
  const s = raw.replace(/\s/g, "");
  const maintenance = /공사|폐쇄|미운영|사용불가|휴장|정비중|운영중지/.test(s);
  const open24h = /상시|연중무휴|24시간|00:00[~\-]24:00|00:00[~\-]23:59/.test(s);
  return { status: maintenance ? "maintenance" : open24h ? "open24h" : raw ? "limited" : "unknown", open24h: open24h && !maintenance };
}
const trailOf = (...v) => (v.join(" ").match(/(서울둘레길\s*\d*\s*코스?|둘레길|한양도성)/) || [null])[0];

async function main() {
  const files = process.argv.slice(2);
  if (!files.length) { console.error("CSV 파일 경로를 넣어 주세요: node scripts/seoul-csv-to-json.mjs 파일.csv"); process.exit(1); }
  const toilets = [];
  let total = 0, skipped = 0, refDate = "";
  for (const f of files) {
    const { header, records } = parseCsv(decode(new Uint8Array(await readFile(f))));
    const c = findCols(header);
    console.log(`\n${path.basename(f)} — ${records.length}행`);
    console.log("원본 열:", header.join(" | "));
    console.log("찾은 열:", Object.entries(c).map(([k, v]) => `${k}=${v ?? "없음"}`).join(", "));
    if (!c.name || !c.lat || !c.lng) {
      console.error("\n이름 또는 위도·경도 열을 못 찾았어요. 위 '원본 열' 목록을 알려주시면 맞춰 드릴게요.");
      process.exit(2);
    }
    const g = (r, k) => (c[k] ? text(r[c[k]]).replace(/\|+\s*$/, "").replace(/\|/g, ", ").trim() : "");
    const has = (k) => Boolean(c[k]);
    records.forEach((r, i) => {
      total++;
      let lat = Number(g(r, "lat")), lng = Number(g(r, "lng"));
      if (lat > 100 && lng < 100) [lat, lng] = [lng, lat]; // 위도·경도 열이 바뀐 경우
      if (!g(r, "name") || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < 37.4 || lat > 37.72 || lng < 126.75 || lng > 127.2) { skipped++; return; }
      const hours = g(r, "hours").replace(/^정시\((.*)\)$/, "$1").replace(/^상시\(24시간\)$/, "24시간");
      const stalls = g(r, "stalls"), dis = g(r, "wheel"), extra = g(r, "extra"), signs = g(r, "signs"), closed = g(r, "closed");
      const address = g(r, "road") || g(r, "lot");
      const ref = g(r, "ref"); if (ref > refDate) refDate = ref;
      toilets.push({
        id: `seoul-${g(r, "id") || `${i + 1}-${lat.toFixed(5)},${lng.toFixed(5)}`}`,
        name: g(r, "name"),
        address: address.startsWith("서울") || !address ? address : `서울특별시 ${g(r, "gu") ? g(r, "gu") + " " : ""}${address}`.replace(/\s+/g, " "),
        lotAddress: g(r, "road") && g(r, "lot") && g(r, "road") !== g(r, "lot") ? g(r, "lot") : "",
        lat: Math.round(lat * 1e6) / 1e6,
        lng: Math.round(lng * 1e6) / 1e6,
        hours,
        ...hoursInfo(hours),
        wheelchair: has("stalls") ? /남자|여자|공용/.test(dis) : yesNo(dis),
        unisex: has("stalls") && stalls ? (/공용/.test(stalls) && !/남자/.test(stalls)) : null,
        diaper: has("extra") ? /기저귀/.test(extra) : yesNo(g(r, "diaper")),
        child: null,
        bell: has("signs") ? /비상벨/.test(signs) : yesNo(g(r, "bell")),
        cctv: has("signs") ? /CCTV/i.test(signs) : yesNo(g(r, "cctv")),
        closedDays: closed && closed !== "기타" ? closed : "",
        weekdaysOnly: /평일/.test(hours),
        category: g(r, "place"),
        trail: trailOf(g(r, "name"), address),
        dong: g(r, "gu"),
        type: g(r, "type"),
        org: g(r, "org") && g(r, "org") !== g(r, "name") ? g(r, "org") : "",
        tel: g(r, "tel") || null,
        ref,
        provider: "서울",
      });
    });
  }
  const meta = {
    provider: "서울",
    dataset: "서울시 공중화장실 위치정보 (서울열린데이터광장 OA-22586)",
    sourcePages: [SOURCE_PAGE],
    count: toilets.length,
    referenceDate: refDate || new Date().toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
  };
  // 빈 값은 빼서 파일 크기를 줄임 (앱은 없는 값을 "정보 없음"으로 표시)
  const KEEP_FALSE = new Set(["wheelchair", "diaper", "bell", "cctv", "unisex", "open24h"]);
  const slim = toilets.map((x) => Object.fromEntries(Object.entries(x).filter(([k, v]) => v !== null && v !== "" && (v !== false || KEEP_FALSE.has(k)))));
  await writeFile(OUTPUT, JSON.stringify({ meta, toilets: slim }));
  console.log(`\n완료: ${toilets.length}곳 저장 (전체 ${total}행, 좌표 없음·서울 밖 ${skipped}행 제외) → data/seoul.json`);
  await mergeAll();
}
main();
