'use strict';
// AI 음악 채널 수집기 — 유튜브 자체 AI 공시 배지를 근거로 채널을 모은다.
// 검색어 → 영상 수집 → 각 영상 시청 페이지의 배지 확인 → AI면 채널 등재.
const { Session, sleep } = require('./cdp.js');
const { wakeServiceWorker } = require('./wake.js');
const fs = require('node:fs');

const QUERIES = JSON.parse(fs.readFileSync(__dirname + '/queries.json', 'utf8'));
const OUT = __dirname + '/harvest-result.json';

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

    let aiHere = 0;
    for (const it of todo) {
      if (state.checkedVideos[it.v]) continue;
      let verdict = null;
      try {
        verdict = JSON.parse(await b.eval(`
          (async () => {
            const html = await (await fetch('https://www.youtube.com/watch?v=${it.v}', { credentials:'omit' })).text();
            return JSON.stringify({ badges: watchBadgeLabels(html) });
          })()
        `));
      } catch (e) { continue; }
      state.checkedVideos[it.v] = 1;
      state.stats.videos++;
      const isAi = (verdict.badges || []).some((l) => /^AI$/i.test(l));
      if (isAi) {
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
