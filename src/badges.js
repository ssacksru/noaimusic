// 시청 페이지 HTML 에서 유튜브의 AI 공시 배지를 읽는다.
// content script 와 service worker 가 함께 쓴다.
(function (root) {
  'use strict';

  function parseInitialData(html) {
    try {
      const m = html.match(/var ytInitialData\s*=\s*(\{.+?\});<\/script>/s);
      return m ? JSON.parse(m[1]) : null;
    } catch (e) { return null; }
  }

  // 페이지를 읽지 못했으면 null — "배지 없음"([])과 반드시 구분해야 한다.
  // 그러지 않으면 네트워크 실패가 곧 "AI 아님" 으로 굳어버린다.
  function watchBadges(html) {
    const d = parseInitialData(html);
    if (!d) return null;
    try {
      const contents = d.contents.twoColumnWatchNextResults.results.results.contents || [];
      const pri = contents.find((x) => x.videoPrimaryInfoRenderer);
      if (!pri) return null;
      return (pri.videoPrimaryInfoRenderer.badges || [])
        .map((b) => b.metadataBadgeRenderer)
        .filter(Boolean);
    } catch (e) { return null; }
  }

  // AI 공시 배지인가. 라벨은 언어마다 다르다(AI·IA·KI·ИИ·एआई·بالذكاء الاصطناعي).
  // 아이콘 종류는 모든 로케일에서 같고, 일반 영상은 이 자리에 배지가 아예 없다(실측 2026-08-20).
  function isAiBadge(b) {
    return !!b && b.icon && b.icon.iconType === 'INFO' && b.style === 'BADGE_STYLE_TYPE_SIMPLE';
  }

  // 배지가 없을 때 쓰는 추정 신호 — 조회수와 해시태그의 조합.
  //
  // 대규모 실측(2026-08-20, 채널 772개 → 오염 제거 후 AI 455 vs 비AI 317):
  //   조회수 3천 미만 + 해시태그 12개 이상 → 검출 23% · 오탐 0.6% (95%CI 0.2~2.3)
  // 남은 오탐 2건도 미표기 AI 로 의심되는 채널이라 실제 오탐은 더 낮다.
  // 원리: AI 는 대량으로 찍어내지만 아무도 듣지 않는다(중앙 조회수 1,206회 vs
  // 비AI 24만회). 낮은 조회수 자체는 신생 창작자·저조회 일반 영상과 겹치므로
  // (조회수 단독 오탐 30%) 해시태그 스팸이 함께 있을 때만 추정한다.
  // 해시태그 단독 폴백은 큰 표본에서 오탐 6.9%로 드러나 제거했다 —
  // 조회수를 모르면 추정하지 않는다.
  const COMBO_VIEWS_MAX = 3000;
  const COMBO_HASHTAG_MIN = 12;
  function hashtagCount(html) {
    try {
      const m = html.match(/var ytInitialData\s*=\s*(\{.+?\});<\/script>/s);
      if (!m) return 0;
      const d = JSON.parse(m[1]);
      const c = d.contents.twoColumnWatchNextResults.results.results.contents || [];
      const sec = (c.find((x) => x.videoSecondaryInfoRenderer) || {}).videoSecondaryInfoRenderer;
      const desc = (sec && sec.attributedDescription && sec.attributedDescription.content)
        || ((sec && sec.description && sec.description.runs) || []).map((r) => r.text || '').join('');
      return (String(desc).match(/#[^\s#]+/g) || []).length;
    } catch (e) { return 0; }
  }

  // 시청 페이지를 받아 AI 여부를 판정한다. null = 판정 불가.
  //
  // 반드시 쿠키를 실어 보낸다 — fetch 옵션을 붙이지 않는 것이 그 방법이다.
  // 쿠키 없이 요청하면 유튜브가 시청 페이지를 거부한다(실측 2026-08-20: 실패 vs 200).
  // 그래서 이 확인은 페이지 컨텍스트에서 해야 하고, 서비스워커에서 하면 통째로 실패한다.
  // useGuess 가 false 면 유튜브 공시만 근거로 삼는다.
  // views 는 피드에서 읽은 그 영상의 조회수 (모르면 null).
  async function checkVideo(videoId, useGuess, views) {
    try {
      const r = await fetch('https://www.youtube.com/watch?v=' + videoId);
      if (!r.ok) return null;
      const html = await r.text();
      const badges = watchBadges(html);
      if (badges === null) return null;
      if (badges.some(isAiBadge)) return { verdict: 'ai', reason: 'label' };
      // 배지 없이 설명란 "콘텐츠 생성 방식" 공시만 있는 영상도 있다(실사용 제보 2026-08-21)
      const H = (typeof module !== 'undefined' && module.exports)
        ? require('./heuristics.js') : root.NAM_HEURISTICS;
      if (H && H.hasAiDisclosure(parseInitialData(html) || {})) {
        return { verdict: 'ai', reason: 'label' };
      }
      if (useGuess && views != null
          && views < COMBO_VIEWS_MAX && hashtagCount(html) >= COMBO_HASHTAG_MIN) {
        return { verdict: 'ai', reason: 'hashtags' };
      }
      return { verdict: 'ok', reason: 'label' };
    } catch (e) { return null; }
  }

  // 채널 단위 확인 — 공시는 영상마다 들쭉날쭉 붙는다(실측 2026-08-21: 한 AI 채널의
  // 최근 8개 중 4개만 설명란 공시). 입구 영상이 깨끗해도 채널의 다른 영상을
  // 몇 개 더 보고 나서야 '아님'으로 캐시한다. RSS 는 공개 XML 이라 쿠키가 필요 없다.
  // 채널의 최근 영상 ID 목록. null = 목록을 못 얻음(판정 보류).
  //
  // RSS(feeds/videos.xml)를 먼저 쓰고, 막히면 채널 영상 페이지에서 직접 읽는다.
  // 유튜브가 RSS 를 404 로 막는 것을 실측했다(2026-08-25) — 한 경로에만 기대면
  // 채널 단위 확인이 통째로 죽는다.
  async function channelVideoIds(channelId) {
    try {
      const r = await fetch('https://www.youtube.com/feeds/videos.xml?channel_id=' + channelId);
      if (r.ok) {
        const xml = await r.text();
        const ids = [...xml.matchAll(/<yt:videoId>([\w-]{11})<\/yt:videoId>/g)].map((m) => m[1]);
        if (ids.length) return ids;
      }
    } catch (e) { /* 다음 경로로 */ }
    try {
      const r = await fetch('https://www.youtube.com/channel/' + channelId + '/videos');
      if (!r.ok) return null;
      const html = await r.text();
      const ids = [];
      const seen = new Set();
      for (const m of html.matchAll(/"videoId":"([\w-]{11})"/g)) {
        if (!seen.has(m[1])) { seen.add(m[1]); ids.push(m[1]); }
        if (ids.length >= 30) break;
      }
      return ids.length ? ids : null;
    } catch (e) { return null; }
  }

  async function checkChannel(channelId, videoId, useGuess, views) {
    const first = await checkVideo(videoId, useGuess, views);
    if (!first || first.verdict === 'ai') return first;
    let ids;
    try { ids = await channelVideoIds(channelId); } catch (e) { ids = null; }
    // 목록을 못 얻으면 입구 영상의 판정을 그대로 쓴다. null 을 돌려주면 이 채널은
    // 영영 캐시되지 않아 같은 확인을 무한 반복하고, 그 요청이 다시 차단을 부른다.
    if (ids === null) return first;
    ids = ids.filter((v) => v !== videoId);
    // 최신·중간·오래된 쪽에서 하나씩 — 미공시가 몰린 구간에 다 걸리지 않게 흩어 본다
    const picks = [...new Set([ids[0], ids[Math.floor(ids.length / 2)], ids[ids.length - 1]])]
      .filter(Boolean);
    for (const v of picks) {
      const r = await checkVideo(v, false, null);
      if (r === null) return null;   // 확인 실패를 '아님'으로 굳히지 않는다
      if (r.verdict === 'ai') return r;
    }
    return first;
  }

  const api = { parseInitialData, watchBadges, isAiBadge, checkVideo, checkChannel, channelVideoIds, hashtagCount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NAM_BADGES = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
