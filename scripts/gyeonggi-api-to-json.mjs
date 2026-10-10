#!/usr/bin/env node
// 경기도 공중화장실 현황 (경기데이터드림 OpenAPI) → data/gyeonggi.json → data/toilets.json 합치기
//
// 사용법 (Node 20 이상, 외부 패키지 없음)
//   GG_OPEN_DATA_KEY=발급받은키 node scripts/gyeonggi-api-to-json.mjs
//
// 인증키는 환경변수로만 받습니다. 앱 코드나 저장소 파일에 넣지 마세요.
// 서비스 이름이 다르면 GG_SERVICE=서비스명 으로 바꿀 수 있습니다 (기본: Publtolt).
// 열 이름을 못 찾으면 첫 번째 데이터의 실제 필드 목록을 출력하니 그 내용을 알려주세요.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mergeAll } from "./merge-data.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data/gyeonggi.json");
const KEY = process.env.GG_OPEN_DATA_KEY;
const SERVICE = process.env.GG_SERVICE || "Publtolt";
const BASE = `https://openapi.gg.go.kr/${SERVICE}`;
const PAGE = 1000;

const text = (v) => (v == null ? "" : String(v).trim());
const nk = (k) => text(k).replace(/[\s_\-()]/g, "").toLowerCase();

// 필드 후보 (경기데이터드림 영문 필드명 / 한글 필드명 모두)
const COLS = {
  sigun: ["SIGUN_NM", "시군명"],
  name: ["PBCTLT_PLC_NM", "TOILET_NM", "화장실명", "PLC_NM"],
  road: ["REFINE_ROADNM_ADDR", "ROADNM_ADDR", "소재지도로명주소"],
  lot: ["REFINE_LOTNO_ADDR", "LOTNO_ADDR", "소재지지번주소"],
  lat: ["REFINE_WGS84_LAT", "WGS84_LAT", "LAT", "위도"],
  lng: ["REFINE_WGS84_LOGT", "WGS84_LOGT", "LOGT", "LON", "경도"],
  hours: ["OPEN_TM_INFO", "OPEN_TM", "개방시간"],
  type: ["PUBLFACLT_DIV_NM", "TOILET_DIV_NM", "DIV_NM", "구분"],
  org: ["MANAGE_INST_NM", "관리기관명"],
  tel: ["MANAGE_INST_TELNO", "TELNO", "전화번호"],
  unisex: ["MALE_FEMALE_TOILET_YN", "MLFML_TOILET_YN", "남녀공용화장실여부"],
  dM: ["MALE_DSPSN_WTRCLS_CNT", "남성용장애인용대변기수"],
  dMU: ["MALE_DSPSN_UIL_CNT", "MALE_DSPSN_URINAL_CNT", "남성용장애인용소변기수"],
  dF: ["FEMALE_DSPSN_WTRCLS_CNT", "여성용장애인용대변기수"],
  kidM: ["MALE_CHILDUSE_WTRCLS_CNT", "MALE_CHILD_WTRCLS_CNT", "남성용어린이용대변기수"],
  kidF: ["FEMALE_CHILDUSE_WTRCLS_CNT", "FEMALE_CHILD_WTRCLS_CNT", "여성용어린이용대변기수"],
  bell: ["EMGNC_BELL_INSTL_YN", "EMERGENCY_BELL_YN", "비상벨설치여부"],
  cctv: ["ENTRNC_CCTV_INSTL_YN", "CCTV_INSTL_YN", "화장실입구CCTV설치유무"],
  diaper: ["DIAPER_EXCHG_TABL_YN", "DIAPR_EXCHN_TABL_YN", "기저귀교환대유무"],
  ref: ["DATA_STD_DE", "데이터기준일자"],
};
// 이름 패턴으로 한 번 더 찾기 (필드명이 조금 달라도)
const PATTERNS = { lat: /lat$/, lng: /(logt|lon|lng)$/, name: /(plc|toilet).*nm$/, road: /road.*addr$/, lot: /lotno.*addr$/, bell: /bell/, cctv: /cctv/, diaper: /diap/ };

function resolve(sample) {
  const keys = Object.keys(sample);
  const map = {};
  for (const [f, cands] of Object.entries(COLS)) {
    map[f] = keys.find((k) => cands.some((c) => nk(c) === nk(k))) ?? (PATTERNS[f] ? keys.find((k) => PATTERNS[f].test(nk(k))) : undefined) ?? null;
  }
  return map;
}
function yesNo(v) {
  const s = text(v).toUpperCase();
  if (["Y", "YES", "1", "TRUE", "있음", "유", "O", "설치"].includes(s)) return true;
  if (["N", "NO", "0", "FALSE", "없음", "무", "X", "미설치"].includes(s)) return false;
  return null;
}
const num = (v) => { const n = Number(text(v).replace(/,/g, "")); return Number.isFinite(n) ? n : 0; };
function hoursInfo(raw) {
  const s = raw.replace(/\s/g, "");
  const maintenance = /공사|폐쇄|미운영|사용불가|휴장|정비중|운영중지/.test(s);
  const open24h = /상시|연중무휴|24시간|00:00[~\-]24:00|00:00[~\-]23:59/.test(s);
  return { status: maintenance ? "maintenance" : open24h ? "open24h" : raw ? "limited" : "unknown", open24h: open24h && !maintenance };
}

async function fetchPage(p) {
  const url = `${BASE}?KEY=${encodeURIComponent(KEY)}&Type=json&pIndex=${p}&pSize=${PAGE}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  const svc = j[SERVICE];
  if (!svc) throw new Error(`응답 형식이 예상과 달라요: ${JSON.stringify(j).slice(0, 300)}`);
  const head = svc[0]?.head || [];
  const total = head.find((h) => h.list_total_count)?.list_total_count ?? 0;
  const code = head.find((h) => h.RESULT)?.RESULT;
  if (code && code.CODE !== "INFO-000") throw new Error(`${code.CODE} ${code.MESSAGE}`);
  return { total, rows: svc[1]?.row || [] };
}

async function main() {
  if (!KEY) throw new Error("GG_OPEN_DATA_KEY 인증키가 없어요. Settings → Secrets and variables → Actions에 넣어 주세요.");
  const first = await fetchPage(1);
  const rows = [...first.rows];
  for (let p = 2; rows.length < first.total; p++) {
    const { rows: more } = await fetchPage(p);
    if (!more.length) break;
    rows.push(...more);
  }
  console.log(`받은 행: ${rows.length} / 전체 ${first.total}`);
  if (!rows.length) { console.error("데이터가 비어 있어요."); process.exit(2); }

  const c = resolve(rows[0]);
  console.log("찾은 필드:", Object.entries(c).map(([k, v]) => `${k}=${v ?? "없음"}`).join(", "));
  if (!c.name || !c.lat || !c.lng) {
    console.error("\n이름 또는 위도·경도 필드를 못 찾았어요. 실제 필드 목록:\n", Object.keys(rows[0]).join(", "));
    process.exit(3);
  }
  const g = (r, k) => (c[k] ? text(r[c[k]]) : "");
  const flag = (r, k) => (c[k] ? yesNo(r[c[k]]) : null);
  let skipped = 0, ref = "";
  const toilets = [];
  rows.forEach((r, i) => {
    const lat = Number(g(r, "lat")), lng = Number(g(r, "lng"));
    if (!g(r, "name") || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < 36.85 || lat > 38.35 || lng < 126.3 || lng > 127.9) { skipped++; return; }
    const hours = g(r, "hours");
    const dis = c.dM || c.dMU || c.dF ? num(r[c.dM]) + num(r[c.dMU]) + num(r[c.dF]) : null;
    const kid = c.kidM || c.kidF ? num(r[c.kidM]) + num(r[c.kidF]) : null;
    if (g(r, "ref") > ref) ref = g(r, "ref");
    toilets.push({
      id: `gg-${i + 1}-${lat.toFixed(5)},${lng.toFixed(5)}`,
      name: g(r, "name"),
      address: g(r, "road") || g(r, "lot"),
      lotAddress: g(r, "road") && g(r, "lot") && g(r, "road") !== g(r, "lot") ? g(r, "lot") : "",
      lat: Math.round(lat * 1e6) / 1e6,
      lng: Math.round(lng * 1e6) / 1e6,
      hours,
      ...hoursInfo(hours),
      wheelchair: dis === null ? null : dis > 0,
      unisex: flag(r, "unisex"),
      diaper: flag(r, "diaper"),
      child: kid === null ? null : kid > 0,
      bell: flag(r, "bell"),
      cctv: flag(r, "cctv"),
      trail: ((g(r, "name") + " " + g(r, "road")).match(/(경기옛길|경기둘레길|둘레길)/) || [null])[0],
      dong: g(r, "sigun"),
      type: g(r, "type"),
      org: g(r, "org"),
      tel: g(r, "tel") || null,
      ref: g(r, "ref"),
      provider: "경기",
    });
  });
  const KEEP_FALSE = new Set(["wheelchair", "diaper", "bell", "cctv", "unisex", "open24h"]);
  const slim = toilets.map((x) => Object.fromEntries(Object.entries(x).filter(([k, v]) => v !== null && v !== "" && (v !== false || KEEP_FALSE.has(k)))));
  await writeFile(OUT, JSON.stringify({
    meta: { provider: "경기", dataset: "경기도 공중화장실 현황 (경기데이터드림 OpenAPI)", sourcePages: ["https://www.data.go.kr/data/15011425/openapi.do"], count: slim.length, referenceDate: ref || new Date().toISOString().slice(0, 10) },
    toilets: slim,
  }));
  console.log(`경기 ${slim.length}곳 저장 (좌표 없음·경기 밖 ${skipped}행 제외) → data/gyeonggi.json`);
  await mergeAll();
}
main().catch((e) => {
  const why = [e.message, e.cause?.code, e.cause?.message].filter(Boolean).join(" / ");
  console.error("실패:", why);
  // GitHub Actions 요약 화면에 바로 보이도록
  if (process.env.GITHUB_ACTIONS) console.log(`::error title=경기 데이터 받기 실패::${why.replace(/\n/g, " ")}`);
  process.exit(1);
});
