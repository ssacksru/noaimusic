'use strict';
// 수집 채널 재검증 v2 — RSS 가 막혔으므로 채널 영상 페이지에서 목록을 읽는다.
//
// 내장 목록은 설치 즉시 전원에게 무조건 차단이고 사용자가 이유를 알 길이 없다.
// 그래서 런타임 학습보다 엄격한 기준을 쓴다:
//   등재 = 최근 영상 여러 편 중 **제목 옆 AI 공시 배지**가 하나라도 있는 채널
//   보류 = 설명란 공시만 있는 채널 (AI 썸네일·AI 더빙만 써도 붙어서 내장하기엔 넓다)
const { httpJson, Session, sleep } = require(__dirname + '/cdp.js');
const { execSync } = require('node:child_process');
const fs = require('node:fs');

// 수집기가 찾은 채널을 받아 배지 기준으로 재검증한다
const IN = process.argv[2] || (__dirname + '/harvest-result.json');
const raw = JSON.parse(fs.readFileSync(IN, 'utf8'));
const rows = Object.entries(raw.channels || {}).map(([cid, v]) => ({
  cid, name: typeof v === 'string' ? v : (v.name || v.channel || cid),
}));

const CHECK = `(async (cid) => {
  const out = { badge: 0, disclosure: 0, checked: 0, fail: 0, listed: 0, title: '' };
  let ids = [];
  // RSS 먼저, 막히면 채널 영상 페이지 (유튜브가 RSS 를 404 로 막았다, 실측 2026-08-25)
  try {
    const r = await fetch('https://www.youtube.com/feeds/videos.xml?channel_id=' + cid);
    if (r.ok) {
      const xml = await r.text();
      ids = [...xml.matchAll(/<yt:videoId>([\\w-]{11})<\\/yt:videoId>/g)].map((m) => m[1]);
    }
  } catch (e) {}
  if (!ids.length) {
    try {
      const r = await fetch('https://www.youtube.com/channel/' + cid + '/videos');
      if (r.ok) {
        const html = await r.text();
        const seen = new Set();
        for (const m of html.matchAll(/"videoId":"([\\w-]{11})"/g)) {
          if (!seen.has(m[1])) { seen.add(m[1]); ids.push(m[1]); }
          if (ids.length >= 20) break;
        }
        const t = html.match(/"title":\\{"simpleText":"([^"]{0,60})"/);
        if (t) out.title = t[1];
      }
    } catch (e) {}
  }
  out.listed = ids.length;
  if (!ids.length) { out.fail = 1; return JSON.stringify(out); }
  // 최신 쪽과 중간·오래된 쪽을 섞어 5편 확인 — 미공시 구간에 다 걸리지 않게
  const picks = [...new Set([ids[0], ids[1], ids[Math.floor(ids.length / 2)],
    ids[ids.length - 2], ids[ids.length - 1]])].filter(Boolean).slice(0, 5);
  for (const v of picks) {
    try {
      const html = await (await fetch('https://www.youtube.com/watch?v=' + v)).text();
      const m = html.match(/var ytInitialData\\s*=\\s*(\\{.+?\\});<\\/script>/s);
      if (!m) { out.fail++; continue; }
      const d = JSON.parse(m[1]);
      out.checked++;
      try {
        const cs = d.contents.twoColumnWatchNextResults.results.results.contents;
        const pri = (cs.find((x) => x.videoPrimaryInfoRenderer) || {}).videoPrimaryInfoRenderer;
        for (const bb of (pri.badges || [])) {
          const mb = bb.metadataBadgeRenderer || {};
          if ((mb.icon || {}).iconType === 'INFO' && mb.style === 'BADGE_STYLE_TYPE_SIMPLE') { out.badge++; break; }
        }
      } catch (e) {}
      for (const ep of d.engagementPanels || []) {
        const items = (((ep.engagementPanelSectionListRenderer || {}).content || {})
          .structuredDescriptionContentRenderer || {}).items || [];
        for (const it of items) if (it && it.howThisWasMadeSectionViewModel) { out.disclosure++; break; }
      }
    } catch (e) { out.fail++; }
  }
  return JSON.stringify(out);
})`;

(async () => {
  let pt = (await httpJson('/json/list')).find((t) => t.type === 'page' && !t.url.startsWith('chrome-extension'));
  if (!pt) {
    execSync("curl -s -X PUT 'http://127.0.0.1:9222/json/new?about:blank'");
    await sleep(2000);
    pt = (await httpJson('/json/list')).find((t) => t.type === 'page' && !t.url.startsWith('chrome-extension'));
  }
  const s = await Session.attach(pt.webSocketDebuggerUrl);
  await s.send('Page.enable'); await s.send('Runtime.enable');
  await s.send('Page.navigate', { url: 'https://www.youtube.com/' });
  await sleep(5000);
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const { cid, name } = rows[i];
    let r;
    try { r = JSON.parse(await s.eval(`${CHECK}(${JSON.stringify(cid)})`, true)); }
    catch (e) { r = { badge: 0, disclosure: 0, checked: 0, fail: 9, listed: 0, title: '' }; }
    out.push({ cid, name, ...r });
    if ((i + 1) % 10 === 0) console.error(`  ${i + 1}/${rows.length}`);
  }
  // 배지로 확인된 채널만 병합 입력으로 남긴다 (refresh-seed.js 가 이 파일을 읽는다)
  fs.writeFileSync(__dirname + '/harvest-verified.json', JSON.stringify(out, null, 1));
  fs.writeFileSync(__dirname + '/harvest-result.json', JSON.stringify({
    channels: Object.fromEntries(out.filter((r) => r.badge > 0).map((r) => [r.cid, r.name])),
    verifiedBy: 'title-badge', checked: out.length,
  }, null, 1));
  const strict = out.filter((r) => r.badge > 0);
  const weak = out.filter((r) => r.badge === 0 && r.disclosure > 0);
  const none = out.filter((r) => r.badge === 0 && r.disclosure === 0 && r.checked > 0);
  const err = out.filter((r) => r.checked === 0);
  console.log(`\n총 ${out.length}개 · 목록 못 얻음 ${err.length}`);
  console.log(`  ✅ 배지 확인(등재): ${strict.length}`);
  console.log(`  ⏸ 설명란 공시만(보류): ${weak.length}`);
  console.log(`  ❌ 근거 없음(제외): ${none.length}`);
  console.log('\n[등재 대상]');
  for (const r of strict) console.log(`  ${r.name} — 배지 ${r.badge}/${r.checked}편`);
  console.log('\n[보류: 설명란만]');
  for (const r of weak) console.log(`  ${r.name} — 공시 ${r.disclosure}/${r.checked}편`);
  await s.send('Page.navigate', { url: 'about:blank' });
  s.close();
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
