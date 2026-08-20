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

  // 설명글의 해시태그 수 — 배지가 없을 때 쓰는 보조 신호.
  // 실측(2026-08-20, AI 42개 vs 사람 플레이리스트 60개): 22개 이상이면 검출 31% · 오탐 2%.
  // 유튜브 공시와 달리 이건 추정이므로 근거를 구분해 남긴다.
  const HASHTAG_MIN = 22;
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
  // useHashtagSignal 이 false 면 유튜브 공시만 근거로 삼는다.
  async function checkVideo(videoId, useHashtagSignal) {
    try {
      const r = await fetch('https://www.youtube.com/watch?v=' + videoId);
      if (!r.ok) return null;
      const html = await r.text();
      const badges = watchBadges(html);
      if (badges === null) return null;
      if (badges.some(isAiBadge)) return { verdict: 'ai', reason: 'label' };
      if (useHashtagSignal && hashtagCount(html) >= HASHTAG_MIN) {
        return { verdict: 'ai', reason: 'hashtags' };
      }
      return { verdict: 'ok', reason: 'label' };
    } catch (e) { return null; }
  }

  const api = { parseInitialData, watchBadges, isAiBadge, checkVideo, hashtagCount, HASHTAG_MIN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NAM_BADGES = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
