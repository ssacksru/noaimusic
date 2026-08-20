'use strict';
// AI 음악 채널 수집기 — 유튜브 자체 AI 공시 배지를 근거로 채널을 모은다.
// 검색어 → 영상 수집 → 각 영상 시청 페이지의 배지 확인 → AI면 채널 등재.
const { Session, sleep } = require('./cdp.js');
const { wakeServiceWorker } = require('./wake.js');
const fs = require('node:fs');

const QUERIES = JSON.parse(fs.readFileSync(__dirname + '/queries.json', 'utf8'));
const OUT = __dirname + '/harvest-result.json';
const save = async (state) => fs.writeFileSync(OUT, JSON.stringify(state));

(async () => {
  const bg = await wakeServiceWorker();
  const b = await Session.attach(bg.webSocketDebuggerUrl);

  const state = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8'))
    : { channels: {}, checkedVideos: {}, doneQueries: [], stats: { videos: 0, ai: 0 } };

  for (const q of QUERIES) {
    if (state.doneQueries.includes(q)) continue;
    let res;
    try {
      res = JSON.parse(await b.eval(`
        (async () => {
          const url = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(${JSON.stringify(q)});
          const html = await (await fetch(url, { credentials: 'omit' })).text();
          const m = html.match(/var ytInitialData\\s*=\\s*(\\{.+?\\});<\\/script>/s);
          if (!m) return JSON.stringify({ items: [] });
          const d = JSON.parse(m[1]);
          const items = [];
          (function walk(n, depth) {
            if (depth > 34 || items.length > 60) return;
            if (Array.isArray(n)) { for (const c of n) walk(c, depth + 1); return; }
            if (!n || typeof n !== 'object') return;
            const l = n.lockupViewModel;
            if (l && l.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' && l.contentId) {
              const md = l.metadata && l.metadata.lockupMetadataViewModel;
              const rows = (md && md.metadata && md.metadata.contentMetadataViewModel &&
                md.metadata.contentMetadataViewModel.metadataRows) || [];
              let ch = '', cid = '';
              for (const row of rows) for (const p of row.metadataParts || []) {
                const br = p.text && p.text.commandRuns && p.text.commandRuns[0] &&
                  p.text.commandRuns[0].onTap && p.text.commandRuns[0].onTap.innertubeCommand &&
                  p.text.commandRuns[0].onTap.innertubeCommand.browseEndpoint;
                if (br && br.browseId && br.browseId.indexOf('UC') === 0) { cid = br.browseId; ch = p.text.content || ''; }
              }
              items.push({ v: l.contentId, cid, ch, t: (md && md.title && md.title.content) || '' });
              return;
            }
            if (n.videoRenderer && n.videoRenderer.videoId) {
              const r = n.videoRenderer;
              const run0 = (r.ownerText || r.longBylineText || {}).runs && (r.ownerText || r.longBylineText).runs[0];
              items.push({ v: r.videoId,
                cid: (run0 && run0.navigationEndpoint && run0.navigationEndpoint.browseEndpoint &&
                      run0.navigationEndpoint.browseEndpoint.browseId) || '',
                ch: (run0 && run0.text) || '',
                t: (r.title && r.title.runs && r.title.runs.map(x=>x.text).join('')) || '' });
              return;
            }
            for (const k in n) walk(n[k], depth + 1);
          })(d, 0);
          return JSON.stringify({ items });
        })()
      `));
    } catch (e) { console.log('  검색 실패:', q, e.message.slice(0, 60)); continue; }

    // 아직 판정 안 된 채널의 영상만 확인 (채널당 1편이면 충분)
    const todo = [];
    const seenCh = new Set();
    for (const it of res.items) {
      if (!it.cid || state.channels[it.cid] || seenCh.has(it.cid)) continue;
      seenCh.add(it.cid); todo.push(it);
    }

    // 못 읽은 페이지를 "AI 아님" 으로 세면 안 된다.
    // 유튜브는 대량 요청 뒤 fetch 를 막는데, 그때 조용히 전부 정상으로 판정돼
    // 수집 결과가 통째로 거짓이 된다(2026-08-20 실측).
    let aiHere = 0, failed = 0;
    for (const it of todo) {
      if (state.checkedVideos[it.v]) continue;
      let badges = null;
      try {
        const r = JSON.parse(await b.eval(`
          (async () => {
            try {
              const html = await (await fetch('https://www.youtube.com/watch?v=${it.v}', { credentials:'omit' })).text();
              const bs = watchBadges(html);
              return JSON.stringify({ ai: bs === null ? null : bs.some(isAiBadge) });
            } catch (e) { return JSON.stringify({ err: String(e.message || e).slice(0, 60) }); }
          })()
        `));
        badges = r.err ? null : r.ai;
      } catch (e) { badges = null; }

      if (badges === null) {           // 판정 불가 — 기록하지 않고 다음에 다시 본다
        failed++;
        if (failed >= 5) { console.log('  요청이 막힌 것으로 보여 중단한다 (나중에 다시 실행하면 이어서 한다)'); await save(state); return; }
        await new Promise((r) => setTimeout(r, 2000 * failed));   // 물러섰다가 재시도
        continue;
      }
      failed = 0;
      state.checkedVideos[it.v] = 1;
      state.stats.videos++;
      if (badges === true) {
        state.channels[it.cid] = it.ch || it.cid;
        state.stats.ai++; aiHere++;
      }
    }
    state.doneQueries.push(q);
    fs.writeFileSync(OUT, JSON.stringify(state));
    console.log(`[${state.doneQueries.length}/${QUERIES.length}] "${q}" — 확인 ${todo.length}채널, AI ${aiHere}개 (누적 ${Object.keys(state.channels).length})`);
  }

  console.log('\n=== 수집 완료 ===');
  console.log('검사한 영상:', state.stats.videos, '| AI 채널:', Object.keys(state.channels).length);
  b.close();
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
