// NoAI Music — ISOLATED world. 설정 전달 · DOM 안전망 · 채널 프로파일링 · 통계 집계.
(function () {
  'use strict';
  const H = window.NAM_HEURISTICS;
  let enabled = true;
  let autoSkip = true;
  let useGuess = true;   // 유튜브 공시가 없을 때 해시태그 같은 추정 신호도 쓸지
  let lists = { allowed: {}, blocked: {}, seed: {} };
  let profiles = {};   // channelId -> 'ai' | 'ok'
  let profileNames = {};
  const videoChannel = {};   // videoId -> channelId (데이터 레이어가 알려준다)

  function pushLists() {
    const blocked = { ...lists.blocked, ...aiProfiles() };
    window.postMessage({
      type: 'NAM_LISTS', enabled,
      lists: { ...lists, blocked, blockedNames: blockedNames(blocked) },
    }, window.location.origin);
  }

  // 믹스 카드는 채널 ID 가 없어 이름으로만 잡을 수 있다.
  // 시드 이름도 포함한다 — 빼면 시드 채널의 믹스가 그대로 살아남는다
  // (최종 테스트 루프 5회차 실측 2026-08-22: "믹스 - balcony9" 잔존).
  function blockedNames(blocked) {
    const out = [];
    const push = (v, id) => {
      const n = (typeof v === 'string' && v.trim()) ? v : profileNames[id];
      if (typeof n === 'string' && n.trim()) out.push(n.trim());
    };
    for (const id in blocked) push(blocked[id], id);   // 학습 항목은 값이 1 — profileNames 에서
    for (const id in lists.seed) if (!(id in blocked)) push(lists.seed[id], id);
    return out.slice(0, 2500);
  }
  function aiProfiles() {
    const out = {};
    for (const id in profiles) if (profiles[id] === 'ai') out[id] = 1;
    return out;
  }

  async function loadState() {
    // 시드 두 갈래: Soul Over AI 스냅샷(영어권 중심) + 유튜브 AI 라벨로 직접 수집한 한국 채널
    const seed = {};
    for (const f of ['data/seed-channels.json', 'data/ai-channels.json']) {
      try {
        const r = await fetch(chrome.runtime.getURL(f));
        Object.assign(seed, (await r.json()).channels || {});
      } catch (e) { /* 한쪽이 없어도 나머지로 동작 */ }
    }
    const sync = await chrome.storage.sync.get({ enabled: true, useSeed: true, autoSkip: true, useGuess: true });
    const local = await chrome.storage.local.get({ profiles: {}, profileNames: {}, viewPass: null });
    viewPass = local.viewPass;
    const mine = await window.NAM_LISTS.getLists();
    profileNames = local.profileNames;
    enabled = sync.enabled;
    autoSkip = sync.autoSkip;
    useGuess = sync.useGuess;
    profiles = local.profiles;
    lists = { allowed: mine.allowed, blocked: mine.blocked, seed: sync.useSeed ? seed : {} };
    pushLists();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    let touched = false;
    if (area === 'sync') {
      if (changes.enabled) { enabled = changes.enabled.newValue; touched = true; }
      if (changes.autoSkip) { autoSkip = changes.autoSkip.newValue; touched = true; }
      if (changes.useGuess) { useGuess = changes.useGuess.newValue; touched = true; }
      if (changes.useSeed) { loadState(); return; }
    } else if (area === 'local') {
      if (changes.viewPass) viewPass = changes.viewPass.newValue;
      if (changes.blocked) { lists.blocked = changes.blocked.newValue || {}; touched = true; }
      if (changes.allowed) { lists.allowed = changes.allowed.newValue || {}; touched = true; }
      if (changes.profiles) { profiles = changes.profiles.newValue || {}; touched = true; }
      if (changes.profileNames) { profileNames = changes.profileNames.newValue || {}; touched = true; }
    }
    if (!touched) return;
    pushLists();
    if (enabled) resweep();
  });

  // ── page.js 신호 수신: 통계 + 프로파일링 후보 ──────────────────
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data) return;
    if (e.data.type === 'NAM_REMOVED') {
      chrome.runtime.sendMessage({ type: 'NAM_STATS', items: e.data.items }).catch(() => {});
    } else if (e.data.type === 'NAM_CANDIDATES') {
      for (const c of e.data.items) {
        if (!/^UC[\w-]{22}$/.test(c.channelId || '')) continue;   // 위조 방지
        if (!(c.channelId in profiles)) queueProfile(c.channelId, c.videoId, c.channel, c.views);
      }
    } else if (e.data.type === 'NAM_IDMAP') {
      Object.assign(videoChannel, e.data.map);
    } else if (e.data.type === 'NAM_WATCH') {
      // MAIN world 메시지는 페이지의 아무 스크립트나 위조할 수 있다.
      // 현재 보고 있는 영상에 대한 것만 받고, 채널 ID 형식을 확인한다.
      const cur = new URLSearchParams(location.search).get('v');
      if (e.data.videoId && cur && e.data.videoId !== cur) return;
      if (e.data.channelId && !/^UC[\w-]{22}$/.test(e.data.channelId)) return;
      watchMeta = e.data;
      // 직접 링크로 온 음악 채널도 확인 대상이다 — 피드에 안 떠도 여기서 학습된다
      // (실사용 사례 2026-08-20: 조회수 100회·해시태그 12개짜리 피아노 채널을 직접 열람)
      if (e.data.channelId && !(e.data.channelId in profiles)) {
        const v = H.evaluate({ title: e.data.title || '', channel: e.data.channel || '',
          channelId: e.data.channelId, durationSec: 9999, isPlaylist: false },
          { allowed: lists.allowed, blocked: {}, seed: {} });
        if (v.reason === 'music-clean') {
          queueProfile(e.data.channelId, e.data.videoId, e.data.channel, e.data.views);
        }
      }
      schedule();
    }
  });

  // 팝업이 "지금 보는 채널"을 물어본다 — 수동 차단 버튼용
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== 'NAM_GET_WATCH' || location.pathname !== '/watch') return;
    const curV = new URLSearchParams(location.search).get('v');
    const wm = watchMeta && (!watchMeta.videoId || !curV || watchMeta.videoId === curV) ? watchMeta : null;
    const chanEl = document.querySelector('ytd-video-owner-renderer a[href], #owner a[href]');
    const m = chanEl && (chanEl.getAttribute('href') || '').match(/\/channel\/(UC[\w-]+)/);
    sendResponse({
      channel: (wm && wm.channel) || (chanEl ? chanEl.textContent.trim() : ''),
      channelId: (wm && wm.channelId) || (m ? m[1] : ''),
    });
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

    // 조회수 — 검사 순서를 정하는 데 쓴다 (낮을수록 AI 일 확률이 높다)
    let views = null;
    for (const el2 of el.querySelectorAll('.ytContentMetadataViewModelMetadataRow span, #metadata-line span')) {
      const t = (el2.textContent || '').trim();
      if (/조회수|views|回視聴|vistas/i.test(t)) { views = H.parseViews(t); break; }
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
      views,
      title: (titleEl && (titleEl.getAttribute('title') || titleEl.textContent) || '').trim(),
      channel: ((chanEl && chanEl.textContent) || (rowEl && rowEl.textContent) || '').trim(),
      channelId: (m && m[1]) || videoChannel[videoId] || '',
      durationSec,
      isPlaylist: /PLAYLIST|RADIO/i.test(el.tagName) || /^(RD|PL|OLAK)/.test(videoId),
    };
  }

  // 새로 학습하거나 목록이 바뀌면 이미 검사한 카드도 다시 판정해야 한다.
  // 그러지 않으면 학습해도 화면에 그대로 남는다(실측 2026-08-20).
  function resweep() {
    for (const el of document.querySelectorAll('[data-nam-checked]')) {
      if (el.dataset.namState !== 'hidden') delete el.dataset.namChecked;
    }
    sweepDom();
  }

  function sweepDom() {
    if (!enabled) return;
    const b = { ...lists.blocked, ...aiProfiles() };
    const merged = { ...lists, blocked: b, blockedNames: blockedNames(b) };
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
          queueProfile(meta.channelId, meta.videoId, meta.channel, meta.views);
        }
      } catch (e) { /* 카드 하나 실패는 무시 */ }
    }
    return hidden;
  }

  // ── 채널 프로파일링 ──────────────────────────────────────────────
  // 시청 페이지 확인은 반드시 페이지 컨텍스트에서 한다. 서비스워커에서 하면
  // 쿠키가 실리지 않아 유튜브가 요청을 거부한다(실측 2026-08-20).
  // 한 건이 실패해도 전체가 멈추지 않도록, 아직 모르는 채널을 매번 다시 채워 넣는다.
  const wanted = new Map();      // channelId -> {videoId, channel}
  const inFlight = new Set();
  const MAX_CONCURRENT = 2;
  let pausedUntil = 0;           // 연속 실패 시 잠시 쉰다
  let failStreak = 0;

  function queueProfile(channelId, videoId, channel, views) {
    // 재생목록·믹스 카드는 ID 가 PL/RD/OLAK 라 시청 페이지로 열 수 없다.
    // 그걸 계속 시도하면 실패가 쌓여 학습 전체가 멈춘다(실측 2026-08-20).
    if (!channelId || channelId in profiles) return;
    if (!/^[\w-]{11}$/.test(videoId || '')) return;
    if (!wanted.has(channelId)) wanted.set(channelId, { videoId, channel, views });
    pump();
  }

  // 확인은 한 번에 두 개씩만 할 수 있으므로 순서가 곧 속도다.
  // 조회수가 낮은 음악 채널일수록 AI 일 확률이 높다 —
  // 실측(2026-08-20): 조회수 5천 미만이면 AI 86% · 사람 3%.
  // 차단 근거로 쓰면 신생 창작자를 막지만, 확인 순서로 쓰면 오탐 없이 빨라진다.
  function byPriority() {
    return [...wanted.entries()].sort((a, b) => {
      const va = a[1].views, vb = b[1].views;
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return va - vb;
    });
  }

  function pump() {
    if (Date.now() < pausedUntil) return;
    for (const [channelId, job] of byPriority()) {
      if (inFlight.size >= MAX_CONCURRENT) break;
      if (inFlight.has(channelId)) continue;
      inFlight.add(channelId);

      window.NAM_BADGES.checkChannel(channelId, job.videoId, useGuess, job.views).then((res) => {
        inFlight.delete(channelId);
        if (res && res.verdict) {
          failStreak = 0;
          profiles[channelId] = res.verdict;
          wanted.delete(channelId);
          chrome.runtime.sendMessage({
            type: 'NAM_MARK', channelId, verdict: res.verdict, channel: job.channel, why: res.reason,
          }).catch(() => {});
          if (res.verdict === 'ai') { pushLists(); resweep(); }
        } else if (++failStreak >= 4) {
          pausedUntil = Date.now() + 60000;   // 계속 실패하면 1분 쉰다
          failStreak = 0;
        }
        pump();
      }).catch(() => { inFlight.delete(channelId); pump(); });
    }
  }

  // 유튜브가 제목 아래에 직접 붙이는 AI 공시 배지.
  // 데이터 경로(page.js)가 주 신호이고 이건 보조다.
  // 라벨은 언어마다 다르므로(AI·IA·KI·ИИ·एआई·بالذكاء الاصطناعي) 글자에 기대지 않는다 —
  // 이 자리에 배지가 있다는 사실 자체가 신호다(일반 영상은 배지가 아예 없다, 실측 2026-08-20).
  // 같은 자리에 "인증됨"·"실시간" 같은 다른 배지도 온다(실측 2026-08-20).
  // AI 공시 배지만 짧은 글자를 갖고, 나머지는 아이콘뿐이라 텍스트가 비어 있다.
  // 그래도 로케일에 따라 글자가 붙을 수 있으니 알려진 것들은 이름으로도 걸러낸다.
  const NOT_AI_BADGE = /인증|verified|실시간|\blive\b|자막|subtitle|cc|4k|hd|멤버|member|new|신규/i;
  function youtubeAiBadge() {
    const badges = document.querySelectorAll(
      '#above-the-fold yt-metadata-badge-renderer, #title yt-metadata-badge-renderer');
    for (const el of badges) {
      const text = (el.textContent || '').trim();
      if (!text || text.length > 24) continue;
      const aria = el.getAttribute('aria-label')
        || (el.querySelector('[aria-label]') || {}).getAttribute?.('aria-label') || '';
      if (NOT_AI_BADGE.test(text) || NOT_AI_BADGE.test(aria)) continue;
      return true;
    }
    return false;
  }

  // 재생이 시작된 뒤에야 AI로 판명된 경우 — 즉시 다음 정상 영상으로 넘긴다.
  // 사이드바·자동재생 큐는 이미 걸러진 상태이므로 "다음" 이 곧 정상 영상이다.
  const skipped = new Set();
  let skipStreak = 0;
  const SKIP_LIMIT = 10;   // 연속으로 AI만 나올 때 무한 이동 방지
  function skipToNext(meta, wm) {
    const vid = new URLSearchParams(location.search).get('v');
    if (!vid || skipped.has(vid) || skipStreak >= SKIP_LIMIT) return false;

    // 이동할 곳을 먼저 확보한다. 없으면 아무것도 소비하지 않고 다음 틱에 다시 시도한다
    // (문서 시작 시점엔 플레이어 버튼·사이드바가 아직 없다).
    const btn = document.querySelector('.ytp-next-button');
    const useBtn = btn && !btn.hasAttribute('disabled') && btn.offsetParent !== null;
    const nextId = wm && wm.nextVideoId && wm.nextVideoId !== vid ? wm.nextVideoId : '';
    const link = document.querySelector('#secondary a.ytLockupMetadataViewModelTitle[href*="/watch"]');
    if (!useBtn && !nextId && !link) return false;

    skipped.add(vid);
    skipStreak++;
    try { const v = document.querySelector('video'); if (v) { v.pause(); v.muted = true; } } catch (e) {}
    chrome.runtime.sendMessage({
      type: 'NAM_STATS',
      items: [{ videoId: vid, title: meta.title, channel: meta.channel, channelId: meta.channelId, reason: 'skipped:youtube-ai-label' }],
    }).catch(() => {});
    // 왜 다른 영상이 나왔는지 알려준다. 넘어간 뒤 페이지에 띄우려고 저장해 둔다.
    try {
      sessionStorage.setItem('nam-skipped', JSON.stringify({
        v: vid, channel: meta.channel, channelId: meta.channelId, at: Date.now(),
      }));
    } catch (e) { /* 저장 실패해도 이동은 계속한다 */ }

    if (useBtn) { btn.click(); return true; }
    if (nextId) { location.href = '/watch?v=' + nextId; return true; }
    location.href = link.getAttribute('href');
    return true;
  }

  // 건너뛴 직후 도착한 페이지에서 조용히 알린다 (재생을 방해하지 않는다)
  function skipToast() {
    let info;
    try {
      const raw = sessionStorage.getItem('nam-skipped');
      if (!raw) return;
      info = JSON.parse(raw);
    } catch (e) { return; }
    if (!info) return;
    // 아직 떠나는 페이지에 있으면 소비하지 않는다 — 도착한 곳에서 띄워야 한다
    if (info.v === new URLSearchParams(location.search).get('v')) return;
    try { sessionStorage.removeItem('nam-skipped'); } catch (e) {}
    if (Date.now() - info.at > 15000 || document.getElementById('nam-toast')) return;
    // 전체화면에서는 재생 컨트롤을 가리므로 띄우지 않는다
    if (document.fullscreenElement) return;

    const el = document.createElement('div');
    el.id = 'nam-toast';
    const msg = document.createElement('span');
    msg.textContent = info.channel ? `AI 음악을 건너뛰었습니다 · ${info.channel}` : 'AI 음악을 건너뛰었습니다';
    el.append(msg);
    if (info.channelId && info.v) {
      const undo = document.createElement('button');
      undo.textContent = '되돌리기';
      undo.onclick = async () => {
        await window.NAM_LISTS.setChannel(info.channelId, info.channel, 'allowed');
        chrome.runtime.sendMessage({ type: 'NAM_MARK', channelId: info.channelId, verdict: 'ok', channel: info.channel }).catch(() => {});
        location.href = '/watch?v=' + info.v;
      };
      el.append(undo);
    }
    document.body.append(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 6000);
  }

  // page.js 가 데이터에서 읽어 보낸 현재 시청 영상 정보 (DOM 보다 정확)
  let watchMeta = null;

  // 팝업에서 "눌러서 보기"로 끊은 10분짜리 통행증 — 차단은 유지하되 이번 재생은 건너뛰지 않는다
  let viewPass = null;
  function passActive(videoId, channelId) {
    if (!viewPass || Date.now() > (viewPass.until || 0)) return false;
    return (viewPass.videoId && viewPass.videoId === videoId)
        || (viewPass.channelId && viewPass.channelId === channelId);
  }

  // ── 시청 페이지: AI 판정 시 건너뛰거나 배너 표시 ─────────────────
  function watchBanner() {
    if (!enabled || location.pathname !== '/watch') return;
    const curV = new URLSearchParams(location.search).get('v');
    const wm = watchMeta && (!watchMeta.videoId || !curV || watchMeta.videoId === curV) ? watchMeta : null;

    const chanEl = document.querySelector('ytd-video-owner-renderer a[href], #owner a[href]');
    const titleEl = document.querySelector('h1.ytd-watch-metadata');
    if (!wm && (!chanEl || !titleEl)) return;
    const m = chanEl && (chanEl.getAttribute('href') || '').match(/\/channel\/(UC[\w-]+)/);
    const meta = {
      title: (wm && wm.title) || (titleEl ? titleEl.textContent.trim() : ''),
      channel: (wm && wm.channel) || (chanEl ? chanEl.textContent.trim() : ''),
      channelId: (wm && wm.channelId) || (m ? m[1] : ''),
      durationSec: 9999, isPlaylist: false,
    };
    if (!meta.title) return;
    const bl = { ...lists.blocked, ...aiProfiles() };
    const merged = { ...lists, blocked: bl, blockedNames: blockedNames(bl) };
    let v = H.evaluate(meta, merged);

    // 유튜브가 직접 AI라고 표시했으면 그 채널을 확정 처리한다 —
    // 이후 이 채널은 피드·검색·자동재생에서 전부 사라진다.
    // 유튜브 AI 공시가 붙었어도 **음악일 때만** 차단·학습한다.
    // 공시는 AI 도구를 조금이라도 쓰면 붙는다 — 게임 실황의 AI 썸네일·AI 더빙에도 붙는다.
    // 음악 관문 없이 공시만 보면 게임·주식 채널까지 AI 음악으로 학습해 버린다
    // (실사용 사고 2026-08-25: 삼국지13 게임 채널이 스킵되고 학습까지 됐다).
    // 구독 중이면 무엇으로 판정됐든 건드리지 않는다. 사용자가 직접 구독한 채널을
    // 필터가 가로채는 건 이 확장이 저지를 수 있는 가장 나쁜 오작동이다.
    if (wm && wm.subscribed) {
      const old0 = document.getElementById('nam-banner');
      if (old0) old0.remove();
      return;
    }
    const isMusic = v.reason !== 'not-music';
    const labeled = isMusic && v.reason !== 'allowlist'
      && ((wm && wm.aiLabeled) || youtubeAiBadge());
    if (labeled) {
      if (meta.channelId && profiles[meta.channelId] !== 'ai') {
        profiles[meta.channelId] = 'ai';
        chrome.runtime.sendMessage({ type: 'NAM_MARK', channelId: meta.channelId, verdict: 'ai', channel: meta.channel }).catch(() => {});
        pushLists();
        resweep();
      }
      v = { action: 'block', reason: 'youtube-ai-label' };
    }

    // 재생이 시작된 뒤 AI로 판명되면 즉시 다음 정상 영상으로 넘어간다.
    // 단, 팝업에서 "눌러서 보기"로 들어온 경우는 사용자가 의도한 재생이므로 두고 본다.
    if (v.action === 'block' && autoSkip && labeled
        && !passActive(curV, meta.channelId)
        && skipToNext(meta, wm)) return;
    if (!labeled) skipStreak = 0;   // 정상 영상에 도달하면 연쇄 카운터 초기화

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
      await window.NAM_LISTS.setChannel(meta.channelId, meta.channel, 'blocked');
      bar.remove();
    };
    bar.querySelector('#nam-allow').onclick = async () => {
      await window.NAM_LISTS.setChannel(meta.channelId, meta.channel, 'allowed');
      bar.remove();
    };
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false;
      try { sweepDom(); } catch (e) {}
      try { watchBanner(); } catch (e) {}
      try { skipToast(); } catch (e) {} });
  }

  loadState().then(() => {
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('yt-navigate-finish', schedule);
    schedule();
    // 화면이 조용해도 아직 모르는 채널이 남아 있으면 계속 확인한다
    setInterval(() => { if (enabled) { sweepDom(); pump(); } }, 15000);
  });
})();
