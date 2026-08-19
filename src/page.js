// NoAI Music — MAIN world (document_start). YouTube 내부 데이터를 원천 필터링한다.
// 안전 원칙: 어떤 실패에도 원본 데이터를 그대로 통과시킨다. 유튜브를 깨느니 필터를 포기한다.
(function () {
  'use strict';
  const H = window.NAM_HEURISTICS;
  if (!H || window.__NAM_PAGE__) return;
  window.__NAM_PAGE__ = true;

  let enabled = true;
  let lists = { allowed: {}, blocked: {}, seed: {} };

  // content script 가 storage에서 읽은 목록·설정을 내려준다
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.type !== 'NAM_LISTS') return;
    enabled = e.data.enabled !== false;
    lists = e.data.lists || lists;
  });

  function report(removed) {
    if (!removed.length) return;
    try {
      window.postMessage({
        type: 'NAM_REMOVED',
        items: removed.map((m) => ({
          videoId: m.videoId, title: m.title, channel: m.channel,
          channelId: m.channelId, reason: m.reason,
        })),
      }, window.location.origin);
    } catch (e) { /* 통계 실패는 무시 */ }
  }

  function filter(data) {
    if (!enabled || !data || typeof data !== 'object') return data;
    try {
      const removed = H.filterTree(data, lists);
      if (removed.length) {
        fixAutoplay(data, removed);
        report(removed);
      }
    } catch (e) { /* 원본 유지 */ }
    return data;
  }

  // 자동재생 대상이 걸러진 영상이면 살아남은 첫 추천 영상으로 바꿔치기 —
  // 재생 흐름이 끊기지 않고 자연스럽게 다음 정상 영상으로 넘어간다.
  function fixAutoplay(data, removed) {
    try {
      const watchNext = data.contents && data.contents.twoColumnWatchNextResults;
      if (!watchNext) return;
      const sets =
        (watchNext.autoplay && watchNext.autoplay.autoplay && watchNext.autoplay.autoplay.sets) || [];
      if (!sets.length) return;
      const removedIds = new Set(removed.map((m) => m.videoId));
      let survivor = null;
      for (const s of sets) {
        for (const key of ['autoplayVideo', 'nextButtonVideo']) {
          const w = s[key] && s[key].watchEndpoint;
          if (w && removedIds.has(w.videoId)) {
            if (survivor === null) survivor = H.firstVideoId(watchNext.secondaryResults);
            if (survivor) w.videoId = survivor;
          }
        }
      }
    } catch (e) { /* 자동재생 교정 실패 시 원본 유지 */ }
  }

  // ── 1) 초기 페이지 데이터: 인라인 스크립트가 값을 넣기 전에 세터를 건다
  function trap(prop) {
    try {
      let value = window[prop];
      if (value) value = filter(value);
      Object.defineProperty(window, prop, {
        configurable: true,
        get() { return value; },
        set(v) { value = filter(v); },
      });
    } catch (e) { /* 후킹 실패 시 초기 데이터는 DOM 안전망이 처리 */ }
  }
  trap('ytInitialData');

  // ── 2) 이후의 모든 로드: fetch 응답 필터 (홈 연속 스크롤·검색·시청 사이드바+자동재생 큐)
  const TARGET = /\/youtubei\/v1\/(next|browse|search)/;
  const origFetch = window.fetch;
  window.fetch = function (input) {
    const p = origFetch.apply(this, arguments);
    let url = '';
    try { url = typeof input === 'string' ? input : (input && input.url) || ''; } catch (e) { }
    if (!enabled || !TARGET.test(url)) return p;
    return p.then((resp) => {
      return resp.clone().json().then((data) => {
        filter(data);
        // 헤더는 content-type 만 재사용한다 — content-encoding/length 를 복사하면
        // 이미 디코딩된 본문과 불일치해 유튜브가 응답을 못 읽는다.
        return new Response(JSON.stringify(data), {
          status: resp.status,
          statusText: resp.statusText,
          headers: { 'content-type': resp.headers.get('content-type') || 'application/json' },
        });
      }).catch(() => resp); // JSON 아니거나 파싱 실패 → 원본 응답
    });
  };
})();
