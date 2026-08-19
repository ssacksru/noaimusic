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
    profileChannel(msg.channelId).then((verdict) => sendResponse({ verdict }))
      .catch(() => sendResponse({ verdict: null }));
    return true; // async
  }
  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => { delete tabCounts[tabId]; });
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.url) { delete tabCounts[tabId]; setBadge(tabId); }
});

// ── 채널 프로파일링: 채널 페이지를 1회 받아 행동 패턴을 본다 ──────────
// 판정은 로컬 캐시에 영구 저장 (채널당 1회 비용)
const AI_TOOL = /\b(suno|udio|mubert|riffusion|soundraw)\b|ai\s*(music|generated|cover|작곡|생성)|인공지능\s*(작곡|음악)/i;

async function profileChannel(channelId) {
  const cache = await chrome.storage.local.get({ profiles: {} });
  if (cache.profiles[channelId]) return cache.profiles[channelId];

  let verdict = 'ok';
  try {
    const resp = await fetch(`https://www.youtube.com/channel/${channelId}/videos`, { credentials: 'omit' });
    const html = await resp.text();
    const m = html.match(/var ytInitialData\s*=\s*(\{.+?\});<\/script>/s);
    const data = m ? JSON.parse(m[1]) : null;

    let score = 0;
    // 신호 1: 채널 설명/메타에 AI 도구 언급
    if (AI_TOOL.test(html)) score += 2;
    // 신호 2: 유튜브의 변형·합성 콘텐츠 라벨
    if (/altered or synthetic|변형되었거나 합성된/i.test(html)) score += 2;
    // 신호 3: 공식 아티스트 채널이면 강한 무죄 신호
    if (/OFFICIAL_ARTIST_BADGE|공식 아티스트 채널/.test(html)) score -= 5;
    // 신호 4: 업로드 패턴 — 장시간 영상을 하루에도 여러 개 (사람이 만들 수 없는 속도)
    if (data) {
      const s = JSON.stringify(data);
      const long = (s.match(/"simpleText":"\d+:\d{2}:\d{2}"/g) || []).length;
      const recent = (s.match(/"publishedTimeText":\{"simpleText":"[^"]*(시간 전|분 전|hours? ago|minutes? ago)"/g) || []).length;
      if (long >= 20 && recent >= 8) score += 2;
    }
    verdict = score >= 2 ? 'ai' : 'ok';
  } catch (e) {
    verdict = 'ok'; // 실패 시 무죄 추정
  }

  cache.profiles[channelId] = verdict;
  await chrome.storage.local.set({ profiles: cache.profiles });
  return verdict;
}
