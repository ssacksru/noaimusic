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
  // 실측(2026-08-20, AI 44 vs 사람 170중 126 — 무명 창작자 66명 포함):
  //   조회수 3천 미만 + 해시태그 8개 이상 → 검출 39% · 오탐 0.8% · 정확도 94%
  //   (해시태그 22개 단독은 검출 27% · 오탐 2.4% — 이 조합이 둘 다 낫다)
  // 원리: AI 는 대량으로 찍어내지만 아무도 듣지 않는다(중앙 조회수 1,572회 vs
  // 사람 54만회, 500배 차이). 낮은 조회수 자체는 신생 창작자와 겹치므로
  // 해시태그 스팸이 함께 있을 때만 추정한다.
  // 조회수를 모르는 경우엔 예전 기준(해시태그 22개)으로만 판단한다.
  const HASHTAG_MIN = 22;
  const COMBO_VIEWS_MAX = 3000;
  const COMBO_HASHTAG_MIN = 8;
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
      if (useGuess) {
        const tags = hashtagCount(html);
        const guess = (views != null)
          ? (views < COMBO_VIEWS_MAX && tags >= COMBO_HASHTAG_MIN)
          : (tags >= HASHTAG_MIN);
        if (guess) return { verdict: 'ai', reason: 'hashtags' };
      }
      return { verdict: 'ok', reason: 'label' };
    } catch (e) { return null; }
  }

  const api = { parseInitialData, watchBadges, isAiBadge, checkVideo, hashtagCount, HASHTAG_MIN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NAM_BADGES = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
