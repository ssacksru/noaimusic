'use strict';
const $ = (id) => document.getElementById(id);
let tab = 'learned';

function today() { return new Date().toISOString().slice(0, 10); }

// 판별 사유를 사람이 읽는 말로. 화면에 내부 코드가 새어나오지 않게 한다.
function reasonLabel(reason) {
  const r = String(reason || '');
  const skipped = r.startsWith('skipped:');
  const base = skipped ? r.slice(8) : r;
  let text;
  if (base === 'youtube-ai-label') text = '유튜브가 AI로 표시';
  else if (base === 'seed') text = '알려진 AI 채널';
  else if (base === 'blocklist') text = '내가 차단한 채널';
  else if (base.startsWith('keyword:')) text = `제목·채널명에 “${base.slice(8)}”`;
  else text = base;
  return skipped ? `${text} · 재생 중 건너뜀` : text;
}

function timeAgo(ts) {
  if (!ts) return '';
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

function row(title, sub, btnText, onClick) {
  const li = document.createElement('li');
  const meta = document.createElement('div');
  meta.className = 'meta';
  const t = document.createElement('span');
  t.className = 't'; t.textContent = title; t.title = title;
  const c = document.createElement('span');
  c.className = 'c'; c.textContent = sub;
  meta.append(t, c);
  li.append(meta);
  if (btnText) {
    const btn = document.createElement('button');
    btn.textContent = btnText;
    btn.onclick = onClick;
    li.append(btn);
  }
  return li;
}

async function allowChannel(channelId, name) {
  const { allowed, blocked } = await chrome.storage.sync.get({ allowed: {}, blocked: {} });
  allowed[channelId] = name || channelId;
  delete blocked[channelId];
  await chrome.storage.sync.set({ allowed, blocked });
  // 학습 결과도 함께 지운다 — 그러지 않으면 다시 AI로 판정된다
  const { profiles, profileNames } = await chrome.storage.local.get({ profiles: {}, profileNames: {} });
  delete profiles[channelId]; delete profileNames[channelId];
  await chrome.storage.local.set({ profiles, profileNames });
  render();
}

async function render() {
  const sync = await chrome.storage.sync.get({ enabled: true, blocked: {}, allowed: {}, useSeed: true, autoSkip: true });
  const local = await chrome.storage.local.get({
    stats: { day: today(), count: 0, total: 0 }, recent: [], profiles: {}, profileNames: {},
  });

  $('toggle').checked = sync.enabled;
  $('useSeed').checked = sync.useSeed;
  $('autoSkip').checked = sync.autoSkip;
  $('dot').classList.toggle('off', !sync.enabled);
  document.body.classList.toggle('disabled', !sync.enabled);

  const stats = local.stats.day === today() ? local.stats : { count: 0, total: local.stats.total };
  $('stat-today').textContent = stats.count;
  $('stat-total').textContent = stats.total;

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const badge = activeTab ? await chrome.action.getBadgeText({ tabId: activeTab.id }) : '';
  $('stat-page').textContent = badge || '0';

  // 최근 걸러낸 목록 — 각 항목에서 바로 되살릴 수 있다
  const ul = $('recent');
  ul.innerHTML = '';
  $('empty').style.display = local.recent.length ? 'none' : 'block';
  $('recent-hint').textContent = local.recent.length > 4 ? `${local.recent.length}건 · 스크롤` : '';
  for (const item of local.recent.slice(0, 30)) {
    const sub = `${item.channel || '알 수 없음'} · ${reasonLabel(item.reason)}${item.at ? ' · ' + timeAgo(item.at) : ''}`;
    ul.append(row(item.title || '(제목 없음)', sub,
      item.channelId ? '허용' : null,
      () => allowChannel(item.channelId, item.channel)));
  }

  // 학습됨 = 프로파일링·재생 중 판별로 스스로 알아낸 채널
  const learned = Object.keys(local.profiles).filter((id) => local.profiles[id] === 'ai');
  $('n-learned').textContent = learned.length;
  $('n-blocked').textContent = Object.keys(sync.blocked).length;
  $('n-allowed').textContent = Object.keys(sync.allowed).length;

  const NOTE = {
    learned: '유튜브의 AI 표시를 보고 이 확장이 직접 알아낸 채널입니다.',
    blocked: '내가 시청 페이지에서 직접 차단한 채널입니다.',
    allowed: '오탐이라 되살린 채널 — 무슨 일이 있어도 표시됩니다.',
  };
  $('tabnote').textContent = NOTE[tab];

  const cl = $('channels');
  cl.innerHTML = '';
  const entries = tab === 'learned'
    ? learned.map((id) => [id, local.profileNames[id] || id])
    : Object.entries(tab === 'blocked' ? sync.blocked : sync.allowed);

  const SUB = {
    learned: '유튜브 AI 표시로 학습됨',
    blocked: '시청 페이지에서 차단함',
    allowed: '항상 표시',
  };
  for (const [id, name] of entries) {
    cl.append(row(name || id, SUB[tab], tab === 'allowed' ? '해제' : '허용', async () => {
      if (tab === 'allowed') {
        const { allowed } = await chrome.storage.sync.get({ allowed: {} });
        delete allowed[id];
        await chrome.storage.sync.set({ allowed });
        render();
      } else {
        allowChannel(id, name);
      }
    }));
  }
  if (!entries.length) {
    const li = document.createElement('li');
    li.innerHTML = '<div class="meta"><span class="c">비어 있음</span></div>';
    cl.append(li);
  }

  // 더 있는 목록은 아래를 흐리게 해 스크롤을 알린다 (반쯤 잘린 행처럼 보이지 않게)
  for (const el of [ul, cl]) el.classList.toggle('more', el.scrollHeight > el.clientHeight + 2);
}

$('toggle').onchange = (e) => chrome.storage.sync.set({ enabled: e.target.checked }).then(render);
$('useSeed').onchange = (e) => chrome.storage.sync.set({ useSeed: e.target.checked });
$('autoSkip').onchange = (e) => chrome.storage.sync.set({ autoSkip: e.target.checked });
for (const b of document.querySelectorAll('.tab')) {
  b.onclick = () => {
    tab = b.dataset.tab;
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
    render();
  };
}

// 번들된 목록 개수는 파일에서 직접 읽어 화면과 데이터가 어긋나지 않게 한다
(async () => {
  let n = 0;
  for (const f of ['data/seed-channels.json', 'data/ai-channels.json']) {
    try {
      const r = await fetch(chrome.runtime.getURL(f));
      n += Object.keys((await r.json()).channels || {}).length;
    } catch (e) { /* 없으면 건너뛴다 */ }
  }
  $('seed-count').textContent = `(${n.toLocaleString('ko-KR')}개)`;
})();

render();
