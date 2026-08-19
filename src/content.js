// NoAI Music — ISOLATED world. 설정 전달 · DOM 안전망 · 채널 프로파일링 · 통계 집계.
(function () {
  'use strict';
  const H = window.NAM_HEURISTICS;
  let enabled = true;
  let lists = { allowed: {}, blocked: {}, seed: {} };
  let profiles = {};   // channelId -> 'ai' | 'ok'
  const pending = new Set();

  function pushLists() {
    window.postMessage({ type: 'NAM_LISTS', enabled, lists: { ...lists, blocked: { ...lists.blocked, ...aiProfiles() } } }, window.location.origin);
  }
  function aiProfiles() {
    const out = {};
    for (const id in profiles) if (profiles[id] === 'ai') out[id] = 1;
    return out;
  }

  async function loadState() {
    const seedResp = await fetch(chrome.runtime.getURL('data/seed-channels.json'));
    const seed = (await seedResp.json()).channels || {};
    const sync = await chrome.storage.sync.get({ enabled: true, blocked: {}, allowed: {}, useSeed: true });
    const local = await chrome.storage.local.get({ profiles: {} });
    enabled = sync.enabled;
    profiles = local.profiles;
    lists = { allowed: sync.allowed, blocked: sync.blocked, seed: sync.useSeed ? seed : {} };
    pushLists();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
      if (changes.enabled) enabled = changes.enabled.newValue;
      if (changes.blocked) lists.blocked = changes.blocked.newValue;
      if (changes.allowed) lists.allowed = changes.allowed.newValue;
      pushLists();
      if (enabled) sweepDom();
    }
  });

  // ── page.js 가 걸러낸 항목 통계 ────────────────────────────────
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.type !== 'NAM_REMOVED') return;
    chrome.runtime.sendMessage({ type: 'NAM_STATS', items: e.data.items }).catch(() => {});
  });

  // ── DOM 안전망: 데이터 필터가 놓친 카드 숨김 + 프로파일링 후보 수집 ──
  const CARD_SEL = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-playlist-renderer, ytd-compact-playlist-renderer, ytd-radio-renderer, ytd-compact-radio-renderer, yt-lockup-view-model';

  // 실측(2026-08-19): 유튜브는 홈·검색·사이드바 카드를 전부 yt-lockup-view-model 로 렌더한다.
  // 클래스명은 camelCase (ytLockupMetadataViewModelTitle 등), 구형 ytd-* 카드도 함께 지원한다.
  function cardMeta(el) {
    const titleEl = el.querySelector('a.ytLockupMetadataViewModelTitle, #video-title, a#video-title-link');
    const chanEl = el.querySelector('a[href^="/@"], a[href*="/channel/"], ytd-channel-name a, #channel-name a');
    const href = chanEl && chanEl.getAttribute('href');
    const m = href && href.match(/\/channel\/(UC[\w-]+)/);
    // lockup 카드는 채널을 링크로 렌더하지 않는다 — 첫 메타데이터 행이 채널명이다
    const rowEl = el.querySelector('.ytContentMetadataViewModelMetadataRow');

    // 길이 배지: 같은 클래스에 "새 동영상" 같은 배지도 섞여 있어 시간 형태만 취한다
    let durationSec = 0;
    for (const b of el.querySelectorAll('.ytBadgeShapeText, ytd-thumbnail-overlay-time-status-renderer #text')) {
      const t = (b.textContent || '').trim();
      if (/^\d+(:\d{2})+$/.test(t)) { durationSec = H.parseDuration(t); break; }
    }

    // videoId — 통계 중복 제거 키. lockup 은 content-id-XXX 클래스에 실려 온다.
    let videoId = '';
    const cid = String(el.className || '').match(/content-id-([\w-]+)/);
    if (cid) videoId = cid[1];
    if (!videoId) {
      const link = el.querySelector('a.ytLockupMetadataViewModelTitle[href], a#thumbnail[href]');
      const vm = link && (link.getAttribute('href') || '').match(/[?&]v=([\w-]+)|\/shorts\/([\w-]+)/);
      if (vm) videoId = vm[1] || vm[2];
    }

    return {
      videoId,
      title: (titleEl && (titleEl.getAttribute('title') || titleEl.textContent) || '').trim(),
      channel: ((chanEl && chanEl.textContent) || (rowEl && rowEl.textContent) || '').trim(),
      channelId: m ? m[1] : '',
      durationSec,
      isPlaylist: /PLAYLIST|RADIO/i.test(el.tagName) || /^(RD|PL|OLAK)/.test(videoId),
    };
  }

  function sweepDom() {
    if (!enabled) return;
    const merged = { ...lists, blocked: { ...lists.blocked, ...aiProfiles() } };
    let hidden = 0;
    for (const el of document.querySelectorAll(CARD_SEL)) {
      try {
        if (el.dataset.namChecked === '1' && el.dataset.namState !== 'candidate') continue;
        const meta = cardMeta(el);
        if (!meta.title) continue;
        el.dataset.namChecked = '1';
        const v = H.evaluate(meta, merged);
        if (v.action === 'block') {
          el.style.display = 'none';
          el.dataset.namState = 'hidden';
          hidden++;
          chrome.runtime.sendMessage({ type: 'NAM_STATS', items: [{ ...meta, reason: v.reason }] }).catch(() => {});
        } else if (v.reason === 'music-clean' && meta.channelId && !(meta.channelId in profiles)) {
          el.dataset.namState = 'candidate';
          queueProfile(meta.channelId);
        }
      } catch (e) { /* 카드 하나 실패는 무시 */ }
    }
    return hidden;
  }

  // ── 채널 프로파일링: 음악인데 AI 신호가 애매한 신규 채널만, 채널당 1회 ──
  function queueProfile(channelId) {
    if (pending.has(channelId) || pending.size > 3) return;
    pending.add(channelId);
    chrome.runtime.sendMessage({ type: 'NAM_PROFILE', channelId })
      .then((res) => {
        pending.delete(channelId);
        if (!res || !res.verdict) return;
        profiles[channelId] = res.verdict;
        if (res.verdict === 'ai') { pushLists(); sweepDom(); }
      })
      .catch(() => pending.delete(channelId));
  }

  // ── 직접 링크로 차단 채널 영상에 들어온 경우: 재생을 끊지 않고 배너만 ──
  function watchBanner() {
    if (!enabled || location.pathname !== '/watch') return;
    const chanEl = document.querySelector('ytd-video-owner-renderer a[href*="/channel/"], #owner a[href*="/channel/"]');
    const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, h1 .style-scope.ytd-watch-metadata');
    if (!chanEl || !titleEl) return;
    const m = chanEl.getAttribute('href').match(/\/channel\/(UC[\w-]+)/);
    const meta = {
      title: titleEl.textContent.trim(), channel: chanEl.textContent.trim(),
      channelId: m ? m[1] : '', durationSec: 9999, isPlaylist: false,
    };
    const merged = { ...lists, blocked: { ...lists.blocked, ...aiProfiles() } };
    const v = H.evaluate(meta, merged);
    const old = document.getElementById('nam-banner');
    if (v.action !== 'block') { if (old) old.remove(); return; }
    if (old) return;
    const bar = document.createElement('div');
    bar.id = 'nam-banner';
    bar.innerHTML = `<span>AI 음악으로 판별된 채널입니다.</span>
      <button id="nam-block">이 채널 차단</button><button id="nam-allow">허용</button>`;
    const anchor = document.querySelector('#below') || document.body;
    anchor.prepend(bar);
    bar.querySelector('#nam-block').onclick = async () => {
      if (!meta.channelId) return bar.remove();
      const { blocked } = await chrome.storage.sync.get({ blocked: {} });
      blocked[meta.channelId] = meta.channel;
      await chrome.storage.sync.set({ blocked });
      bar.remove();
    };
    bar.querySelector('#nam-allow').onclick = async () => {
      if (meta.channelId) {
        const { allowed } = await chrome.storage.sync.get({ allowed: {} });
        allowed[meta.channelId] = meta.channel;
        await chrome.storage.sync.set({ allowed });
      }
      bar.remove();
    };
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; try { sweepDom(); watchBanner(); } catch (e) {} });
  }

  loadState().then(() => {
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('yt-navigate-finish', schedule);
    schedule();
  });
})();
