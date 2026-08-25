'use strict';
// 수집 결과를 내장 목록에 반영한다. 정기 갱신의 마지막 단계.
//
//   node tools/harvest.js            # 검색 → 유튜브 AI 공시 확인 → tools/harvest-result.json
//   node tools/refresh-seed.js       # 그 결과를 data/ai-channels.json 에 병합
//
// 원칙: 유튜브가 직접 AI로 표시한 채널만 넣는다. 추측·휴리스틱 판정은 절대 넣지 않는다 —
// 내장 목록은 설치 즉시 무조건 차단되므로 오탐이 그대로 사용자 피해가 된다.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'data/ai-channels.json');
const SEED = path.join(ROOT, 'data/seed-channels.json');
const RESULT = process.argv[2] || path.join(__dirname, 'harvest-result.json');

if (!fs.existsSync(RESULT)) {
  console.error(`수집 결과가 없다: ${RESULT}\n먼저 node tools/harvest.js 를 돌려라.`);
  process.exit(1);
}

const result = JSON.parse(fs.readFileSync(RESULT, 'utf8'));
const current = JSON.parse(fs.readFileSync(OUT, 'utf8'));
const seed = JSON.parse(fs.readFileSync(SEED, 'utf8')).channels;

// 수집기는 AI 로 판정된 채널만 기록한다 — 값은 채널 이름이다.
// (판정을 명시한 {verdict, name} 형태도 받아준다)
const found = {};
for (const [cid, v] of Object.entries(result.channels || {})) {
  if (!/^UC[\w-]{22}$/.test(cid)) continue;      // 형식 검증
  if (v && typeof v === 'object') {
    if (v.verdict && v.verdict !== 'ai') continue;
    found[cid] = (v.name || v.channel || '').trim() || cid;
  } else {
    found[cid] = String(v || '').trim() || cid;
  }
}

const before = Object.keys(current.channels).length;
const addedNames = [];
let skippedSeed = 0, skippedDup = 0;
for (const [cid, name] of Object.entries(found)) {
  if (cid in seed) { skippedSeed++; continue; }   // 이미 다른 목록에 있음
  if (cid in current.channels) { skippedDup++; continue; }
  current.channels[cid] = name;
  addedNames.push(name);
}
const added = addedNames.length;

if (!added) {
  console.log(`새 채널 없음 (수집 ${Object.keys(found).length}개 중 기존 ${skippedSeed}개는 시드에 이미 있음)`);
  process.exit(0);
}

const today = new Date().toISOString().slice(0, 10);
current.collected = today;
current.note = current.note || '유튜브가 직접 AI로 표시한 채널만 등재. 추측·휴리스틱 판정은 포함하지 않는다.';
current.history = current.history || [];
current.history.push({ date: today, added, total: before + added });

// 채널 ID 순으로 정렬해 저장 — diff 가 읽히게
const sorted = {};
for (const k of Object.keys(current.channels).sort()) sorted[k] = current.channels[k];
current.channels = sorted;

fs.writeFileSync(OUT, JSON.stringify(current, null, 1) + '\n');
console.log(`병합 완료: +${added}개 (${before} → ${before + added})`);
console.log(`이미 있어 건너뜀: 시드 ${skippedSeed}개 · 수집목록 ${skippedDup}개`);
console.log('\n새로 등재된 채널:');
for (const name of addedNames.sort()) console.log(`  ${name}`);
console.log('\n다음: npm test → manifest 버전 올리기 → npm run build → 스토어 제출');
