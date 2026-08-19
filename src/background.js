// NoAI Music — service worker. 배지 카운트 · 일별 통계 · 채널 프로파일링.
'use strict';

const tabCounts = {};          // tabId -> 이 탭에서 거른 videoId Set
const RECENT_CAP = 50;

function today() { return new Date().toISOString().slice(0, 10); }

async function bumpStats(items) {
  const st = await chrome.storage.local.get({ stats: { day: today(), count: 0, total: 0 }, recent: [] });
  const stats = st.stats;
  if (stats.day !== today()) { stats.day = today(); stats.count = 0; }
  stats.count += items.length;
  stats.total += items.length;
  const recent = items
    .map((i) => ({ title: i.title, channel: i.channel, channelId: i.channelId, reason: i.reason, at: Date.now() }))
    .concat(st.recent)
    .slice(0, RECENT_CAP);
  await chrome.storage.local.set({ stats, recent });
}

function setBadge(tabId) {
  const n = tabCounts[tabId] ? tabCounts[tabId].size : 0;
  chrome.action.setBadgeText({ tabId, text: n ? String(n) : '' }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#c00' }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'NAM_STATS') {
    const tabId = sender.tab && sender.tab.id;
    const fresh = [];
    if (tabId != null) {
      const seen = tabCounts[tabId] || (tabCounts[tabId] = new Set());
      for (const i of msg.items) {
        const key = i.videoId || i.title;
        if (key && !seen.has(key)) { seen.add(key); fresh.push(i); }
      }
      setBadge(tabId);
    }
    if (fresh.length) bumpStats(fresh);
    return false;
  }
  if (msg.type === 'NAM_PROFILE') {
    profileChannel(msg.channelId, msg.videoId).then((verdict) => sendResponse({ verdict }))
      .catch(() => sendResponse({ verdict: null }));
    return true; // async
  }
  if (msg.type === 'NAM_MARK') {
    markChannel(msg.channelId, msg.verdict).then((verdict) => sendResponse({ verdict }))
      .catch(() => sendResponse({ verdict: null }));
    return true; // async
  }
  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => { delete tabCounts[tabId]; });
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.url) { delete tabCounts[tabId]; setBadge(tabId); }
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

// 시청 페이지에서 유튜브가 붙인 배지 라벨을 꺼낸다 (AI 공시면 ["AI"])
function watchBadgeLabels(html) {
  const d = parseInitialData(html);
  try {
    const contents = d.contents.twoColumnWatchNextResults.results.results.contents || [];
    const pri = contents.find((x) => x.videoPrimaryInfoRenderer);
    return (pri.videoPrimaryInfoRenderer.badges || [])
      .map((b) => b.metadataBadgeRenderer && b.metadataBadgeRenderer.label)
      .filter(Boolean);
  } catch (e) { return []; }
}

async function getText(url) {
  const r = await fetch(url, { credentials: 'omit' });
  return r.text();
}

async function profileChannel(channelId, sampleVideoId) {
  const cache = await chrome.storage.local.get({ profiles: {} });
  if (cache.profiles[channelId]) return cache.profiles[channelId];

  // 근거는 유튜브 자체 공시 배지 하나뿐이다.
  // HTML 전체 문자열 매칭은 쓰지 않는다 — 사이드바 추천에 AI 영상이 섞이면
  // 예능·스포츠 채널까지 AI로 판정되는 것을 실측으로 확인했다(2026-08-19).
  // AI 채널은 사실상 전 영상에 라벨이 붙으므로(실측 3/3) 표본 1편이면 충분하다.
  let verdict = 'ok';
  try {
    let ids = sampleVideoId ? [sampleVideoId] : [];
    if (!ids.length) {
      const chanHtml = await getText(`https://www.youtube.com/channel/${channelId}/videos`);
      ids = [...new Set((chanHtml.match(/"videoId":"[\w-]{11}"/g) || [])
        .map((x) => x.slice(11, -1)))].slice(0, 2);
    }
    for (const id of ids) {
      const html = await getText(`https://www.youtube.com/watch?v=${id}`);
      if (watchBadgeLabels(html).some((l) => /^AI$/i.test(l))) { verdict = 'ai'; break; }
    }
  } catch (e) {
    verdict = 'ok'; // 실패 시 무죄 추정
  }

  cache.profiles[channelId] = verdict;
  await chrome.storage.local.set({ profiles: cache.profiles });
  return verdict;
}

// 시청 페이지에서 content script 가 배지를 직접 본 경우 — 즉시 채널을 AI로 확정한다
async function markChannel(channelId, verdict) {
  const cache = await chrome.storage.local.get({ profiles: {} });
  if (cache.profiles[channelId] === verdict) return verdict;
  cache.profiles[channelId] = verdict;
  await chrome.storage.local.set({ profiles: cache.profiles });
  return verdict;
}
