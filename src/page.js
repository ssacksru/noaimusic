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

  function post(type, payload) {
    try { window.postMessage(Object.assign({ type }, payload), window.location.origin); }
    catch (e) { /* 통계·학습 신호 실패는 무시 */ }
  }

  function filter(data) {
    if (!enabled || !data || typeof data !== 'object') return data;
    try {
      const { removed, candidates, idMap } = H.filterTree(data, lists);
      if (removed.length) {
        fixAutoplay(data, removed);
        post('NAM_REMOVED', {
          items: removed.map((m) => ({
            videoId: m.videoId, title: m.title, channel: m.channel,
            channelId: m.channelId, reason: m.reason,
          })),
        });
      }
      // 음악인데 AI 신호가 없는 처음 보는 채널 — 프로파일링 후보로 넘긴다
      if (candidates.length) {
        const seen = new Set();
        const uniq = candidates.filter((c) => !seen.has(c.channelId) && seen.add(c.channelId));
        post('NAM_CANDIDATES', { items: uniq.slice(0, 20) });
      }
      // 화면 카드는 채널을 /@handle 로만 링크해 채널 ID 를 알 수 없다.
      // 데이터가 아는 videoId→channelId 매핑을 넘겨 학습 결과가 화면에 반영되게 한다.
      const ids = Object.keys(idMap);
      if (ids.length) post('NAM_IDMAP', { map: idMap });
      reportWatch(data);
    } catch (e) { /* 원본 유지 */ }
    return data;
  }

  // 현재 시청 중인 영상의 채널 ID와 유튜브 자체 AI 공시 배지를 데이터에서 직접 읽어 알린다.
  // DOM 은 채널을 /@handle 로만 링크해서 채널 ID를 얻을 수 없다(2026-08-19 실측).
  function reportWatch(data) {
    try {
      const wn = data.contents && data.contents.twoColumnWatchNextResults;
      if (!wn) return;
      const contents = (wn.results && wn.results.results && wn.results.results.contents) || [];
      const pri = (contents.find((x) => x.videoPrimaryInfoRenderer) || {}).videoPrimaryInfoRenderer;
      const sec = (contents.find((x) => x.videoSecondaryInfoRenderer) || {}).videoSecondaryInfoRenderer;
      if (!pri && !sec) return;
      // AI 공시 배지는 라벨이 언어마다 다르므로(AI·IA·KI·ИИ…) 아이콘 종류로 본다
      const aiLabeled = ((pri && pri.badges) || []).some((b) => {
        const r = b.metadataBadgeRenderer;
        return r && r.icon && r.icon.iconType === 'INFO' && r.style === 'BADGE_STYLE_TYPE_SIMPLE';
      });
      const owner = sec && sec.owner && sec.owner.videoOwnerRenderer;
      const be = owner && owner.navigationEndpoint && owner.navigationEndpoint.browseEndpoint;
      const runs = (pri && pri.title && pri.title.runs) || [];
      // 다음 재생 후보는 이미 필터를 거친 값이라 그대로 건너뛸 대상으로 쓸 수 있다
      const sets = (wn.autoplay && wn.autoplay.autoplay && wn.autoplay.autoplay.sets) || [];
      const apId = (sets[0] && sets[0].autoplayVideo && sets[0].autoplayVideo.watchEndpoint &&
        sets[0].autoplayVideo.watchEndpoint.videoId) || '';
      // 조회수 — 시청 중인 채널을 프로파일링할 때 추정 규칙에 쓴다
      let views = null;
      try {
        const vc = pri.viewCount.videoViewCountRenderer;
        views = H.parseViews((vc.viewCount && (vc.viewCount.simpleText ||
          (vc.viewCount.runs || []).map((r) => r.text).join(''))) || '');
      } catch (e) { /* 없으면 null */ }
      post('NAM_WATCH', {
        views,
        nextVideoId: apId || H.firstVideoId(wn.secondaryResults) || '',
        videoId: (data.currentVideoEndpoint && data.currentVideoEndpoint.watchEndpoint &&
          data.currentVideoEndpoint.watchEndpoint.videoId) || '',
        channelId: (be && be.browseId) || '',
        channel: (owner && owner.title && owner.title.runs && owner.title.runs[0] && owner.title.runs[0].text) || '',
        title: runs.map((r) => r.text || '').join(''),
        aiLabeled,
      });
    } catch (e) { /* 시청 메타 추출 실패는 무시 */ }
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
