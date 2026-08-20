// NoAI Music — service worker. 배지 카운트 · 일별 통계 · 채널 프로파일링.
'use strict';

const tabCounts = {};          // tabId -> { url, seen: Set(videoId) }
const RECENT_CAP = 50;

function today() { return new Date().toISOString().slice(0, 10); }

const keyOf = (i) => i.videoId || i.title;

async function bumpStats(items) {
  const st = await chrome.storage.local.get({ stats: { day: today(), count: 0, total: 0 }, recent: [] });
  const stats = st.stats;
  if (stats.day !== today()) { stats.day = today(); stats.count = 0; }
  // 카운터는 "걸러낸 횟수" — 같은 영상을 다른 페이지에서 또 막으면 또 센다(광고차단기와 같은 방식).
  stats.count += items.length;
  stats.total += items.length;

  // 목록은 "무엇을 걸렀나" — 같은 영상은 한 줄로 합치고 최신 시각으로 올린다.
  const fresh = items.map((i) => ({
    videoId: i.videoId || '', title: i.title, channel: i.channel,
    channelId: i.channelId, reason: i.reason, at: Date.now(),
  }));
  const seen = new Set(fresh.map(keyOf));
  const recent = fresh
    .concat(st.recent.filter((r) => !seen.has(keyOf(r))))
    .slice(0, RECENT_CAP);
  await chrome.storage.local.set({ stats, recent });
}

function setBadge(tabId) {
  const rec = tabCounts[tabId];
  const n = rec ? rec.seen.size : 0;
  chrome.action.setBadgeText({ tabId, text: n ? String(n) : '' }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#c00' }).catch(() => {});
}

// 페이지가 바뀌면 카운트를 새로 시작하되, 판정은 통계가 도착한 시점의 URL로 한다.
// tabs.onUpdated 로 지우면 문서 시작 직후의 필터링 결과가 곧바로 지워진다(실측).
function bucketFor(tabId, url) {
  const page = (url || '').split('#')[0];
  const rec = tabCounts[tabId];
  if (!rec || rec.url !== page) {
    tabCounts[tabId] = { url: page, seen: new Set() };
  }
  return tabCounts[tabId];
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'NAM_STATS') {
    const tabId = sender.tab && sender.tab.id;
    const fresh = [];
    if (tabId != null) {
      const { seen } = bucketFor(tabId, sender.url || (sender.tab && sender.tab.url));
      for (const i of msg.items) {
        const key = keyOf(i);
        if (key && !seen.has(key)) { seen.add(key); fresh.push(i); }
      }
      setBadge(tabId);
    }
    if (fresh.length) bumpStats(fresh);
    return false;
  }
  if (msg.type === 'NAM_PROFILE') {
    profileChannel(msg.channelId, msg.videoId, msg.channel).then((verdict) => sendResponse({ verdict }))
      .catch(() => sendResponse({ verdict: null }));
    return true; // async
  }
  if (msg.type === 'NAM_MARK') {
    markChannel(msg.channelId, msg.verdict, msg.channel).then((verdict) => sendResponse({ verdict }))
      .catch(() => sendResponse({ verdict: null }));
    return true; // async
  }
  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => { delete tabCounts[tabId]; });
// 유튜브를 떠나면 배지를 지운다 (같은 탭에서 페이지만 바뀌는 경우는 bucketFor 가 처리한다)
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.url && !/^https:\/\/www\.youtube\.com\//.test(info.url)) {
    delete tabCounts[tabId];
    setBadge(tabId);
  }
});

// ── 채널 프로파일링 ────────────────────────────────────────────────
// 결정적 신호는 유튜브 자체 AI 공시 배지다(시청 페이지의 videoPrimaryInfoRenderer.badges).
// 채널 목록 페이지엔 이 배지가 없으므로, 대표 영상 몇 개의 시청 페이지를 받아 확인한다.
// 판정은 채널 단위로 영구 캐시 — 채널당 1회 비용.
function parseInitialData(html) {
  try {
    const m = html.match(/var ytInitialData\s*=\s*(\{.+?\});<\/script>/s);
    return m ? JSON.parse(m[1]) : null;
  } catch (e) { return null; }
}

// 시청 페이지에서 유튜브가 붙인 배지를 꺼낸다.
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

// 예전 이름 — 수집기와 테스트가 라벨 목록을 쓴다
function watchBadgeLabels(html) {
  const badges = watchBadges(html);
  return badges === null ? null : badges.map((b) => b.label).filter(Boolean);
}

async function getText(url) {
  const r = await fetch(url, { credentials: 'omit' });
  return r.text();
}

// 학습한 채널은 이름도 함께 남긴다 — 팝업에서 사람이 알아볼 수 있어야 한다
async function rememberName(channelId, name) {
  if (!name) return;
  const { profileNames } = await chrome.storage.local.get({ profileNames: {} });
  if (profileNames[channelId] === name) return;
  profileNames[channelId] = name;
  await chrome.storage.local.set({ profileNames });
}

async function profileChannel(channelId, sampleVideoId, channelName) {
  const cache = await chrome.storage.local.get({ profiles: {} });
  if (cache.profiles[channelId]) return cache.profiles[channelId];

  // 근거는 유튜브 자체 공시 배지 하나뿐이다.
  // HTML 전체 문자열 매칭은 쓰지 않는다 — 사이드바 추천에 AI 영상이 섞이면
  // 예능·스포츠 채널까지 AI로 판정되는 것을 실측으로 확인했다(2026-08-19).
  // AI 채널은 사실상 전 영상에 라벨이 붙으므로(실측 3/3) 표본 1편이면 충분하다.
  // null = 판정 불가. 캐시하지 않고 다음 기회에 다시 본다.
  let verdict = null;
  try {
    let ids = sampleVideoId ? [sampleVideoId] : [];
    if (!ids.length) {
      const chanHtml = await getText(`https://www.youtube.com/channel/${channelId}/videos`);
      ids = [...new Set((chanHtml.match(/"videoId":"[\w-]{11}"/g) || [])
        .map((x) => x.slice(11, -1)))].slice(0, 2);
    }
    for (const id of ids) {
      const badges = watchBadges(await getText(`https://www.youtube.com/watch?v=${id}`));
      if (!badges) continue;                       // 못 읽은 페이지는 근거가 아니다
      if (badges.some(isAiBadge)) { verdict = 'ai'; break; }
      verdict = 'ok';                              // 확인했고 공시가 없었다
    }
  } catch (e) {
    verdict = null; // 네트워크 실패를 무죄로 굳히지 않는다
  }

  if (verdict) {
    cache.profiles[channelId] = verdict;
    await chrome.storage.local.set({ profiles: cache.profiles });
    if (verdict === 'ai') await rememberName(channelId, channelName);
  }
  return verdict;
}

// 시청 페이지에서 content script 가 배지를 직접 본 경우 — 즉시 채널을 AI로 확정한다
async function markChannel(channelId, verdict, channelName) {
  await rememberName(channelId, channelName);
  const cache = await chrome.storage.local.get({ profiles: {} });
  if (cache.profiles[channelId] === verdict) return verdict;
  cache.profiles[channelId] = verdict;
  await chrome.storage.local.set({ profiles: cache.profiles });
  return verdict;
}
