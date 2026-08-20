// 차단·허용 목록 저장소.
//
// storage.sync 는 항목당 8KB 한도라 채널 100여 개에서 저장이 조용히 실패한다(실측).
// 매일 음악을 듣는 사람은 몇 달이면 그 선을 넘는다. 그래서 목록은 용량이 큰 local 에 둔다.
// (설정 값 세 개만 sync 로 기기 간 동기화한다 — 작고 거의 안 바뀐다.)
// 예전 버전이 sync 에 쌓아둔 목록은 처음 읽을 때 local 로 옮긴다.
(function (root) {
  'use strict';

  const KEYS = ['blocked', 'allowed'];

  async function getLists() {
    const local = await chrome.storage.local.get({ blocked: {}, allowed: {}, listsMigrated: false });
    if (local.listsMigrated) return { blocked: local.blocked, allowed: local.allowed };

    // 구버전에서 넘어온 경우: sync 에 있던 것을 합치고 그쪽은 비운다
    let legacy = { blocked: {}, allowed: {} };
    try { legacy = await chrome.storage.sync.get({ blocked: {}, allowed: {} }); } catch (e) { /* 없으면 그만 */ }
    const merged = {
      blocked: Object.assign({}, legacy.blocked, local.blocked),
      allowed: Object.assign({}, legacy.allowed, local.allowed),
    };
    await chrome.storage.local.set({ ...merged, listsMigrated: true });
    try { await chrome.storage.sync.remove(KEYS); } catch (e) { /* 실패해도 local 이 진실 */ }
    return merged;
  }

  // 한 채널을 목록 사이에서 옮긴다. to 가 null 이면 양쪽에서 제거.
  async function setChannel(channelId, name, to) {
    if (!channelId) return null;
    const lists = await getLists();
    delete lists.blocked[channelId];
    delete lists.allowed[channelId];
    if (to) lists[to][channelId] = name || channelId;
    await chrome.storage.local.set({ blocked: lists.blocked, allowed: lists.allowed });
    return lists;
  }

  const api = { getLists, setChannel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NAM_LISTS = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
