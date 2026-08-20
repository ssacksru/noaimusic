// NoAI Music — service worker. 배지 카운트 · 일별 통계 · 채널 프로파일링.
'use strict';

// 설치 직후, 이미 열려 있던 유튜브 탭에는 콘텐츠 스크립트가 주입되지 않는다.
// 사용자는 "설치했는데 AI 배지가 있어도 안 걸러진다"를 겪는다(2026-08-20 실사용 제보).
// 첫 설치 때 한 번, 열려 있는 유튜브 탭을 새로고침해 즉시 동작하게 한다.
// (host 권한이 youtube.com 을 덮으므로 추가 권한은 필요 없다)
chrome.runtime.onInstalled.addListener(async (details) => {
  try { await chrome.storage.local.set({ installedEvent: { reason: details.reason, at: Date.now() } }); } catch (e) {}
  if (details.reason !== 'install') return;
  try {
    const tabs = await chrome.tabs.query({ url: 'https://www.youtube.com/*' });
    for (const t of tabs) {
      try { await chrome.tabs.reload(t.id); } catch (e) { /* 닫힌 탭 등은 무시 */ }
    }
  } catch (e) { /* 조회 실패해도 설치는 계속 */ }
});

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
  // (시크릿 탭 발 항목은 빈 객체로 와서 카운터에만 반영되고 목록에는 안 남는다)
  const fresh = items.filter((i) => i.title || i.videoId).map((i) => ({
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
    // 시크릿 탭에서는 "무엇을 걸렀는지"(제목·채널)를 기록에 남기지 않는다 —
    // 시크릿의 기대에 맞게 개수만 센다. 필터링 자체는 동일하게 동작한다.
    const incog = !!(sender.tab && sender.tab.incognito);
    if (fresh.length) bumpStats(incog ? fresh.map(() => ({})) : fresh);
    return false;
  }
  if (msg.type === 'NAM_MARK') {
    markChannel(msg.channelId, msg.verdict, msg.channel, msg.why).then((verdict) => sendResponse({ verdict }))
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

// ── 학습 결과 저장 ────────────────────────────────────────────────
// 시청 페이지 확인은 content script 가 한다(페이지 컨텍스트라야 쿠키가 실린다).
// 서비스워커에서 요청하면 유튜브가 거부한다 — 실측 2026-08-20.

// 학습한 채널은 이름도 함께 남긴다 — 팝업에서 사람이 알아볼 수 있어야 한다
async function rememberName(channelId, name) {
  if (!name) return;
  const { profileNames } = await chrome.storage.local.get({ profileNames: {} });
  if (profileNames[channelId] === name) return;
  profileNames[channelId] = name;
  await chrome.storage.local.set({ profileNames });
}

// 시청 페이지에서 content script 가 배지를 직접 본 경우 — 즉시 채널을 AI로 확정한다
async function markChannel(channelId, verdict, channelName, why) {
  // 형식이 어긋난 ID 는 저장하지 않는다 (메시지 위조·버그 방어)
  if (!/^UC[\w-]{22}$/.test(channelId || '')) return null;
  if (verdict !== 'ai' && verdict !== 'ok') return null;
  await rememberName(channelId, channelName);
  if (why) {
    const { profileWhy } = await chrome.storage.local.get({ profileWhy: {} });
    if (profileWhy[channelId] !== why) {
      profileWhy[channelId] = why;
      await chrome.storage.local.set({ profileWhy });
    }
  }
  const cache = await chrome.storage.local.get({ profiles: {} });
  if (cache.profiles[channelId] === verdict) return verdict;
  cache.profiles[channelId] = verdict;
  await chrome.storage.local.set({ profiles: cache.profiles });
  return verdict;
}
