'use strict';
const $ = (id) => document.getElementById(id);
let tab = 'blocked';

function today() { return new Date().toISOString().slice(0, 10); }

async function render() {
  const sync = await chrome.storage.sync.get({ enabled: true, blocked: {}, allowed: {}, useSeed: true });
  const local = await chrome.storage.local.get({ stats: { day: today(), count: 0, total: 0 }, recent: [] });

  $('toggle').checked = sync.enabled;
  $('useSeed').checked = sync.useSeed;
  $('dot').classList.toggle('off', !sync.enabled);

  const stats = local.stats.day === today() ? local.stats : { count: 0, total: local.stats.total };
  $('stat-today').textContent = stats.count;
  $('stat-total').textContent = stats.total;

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const badge = activeTab ? await chrome.action.getBadgeText({ tabId: activeTab.id }) : '';
  $('stat-page').textContent = badge || '0';

  // 최근 걸러낸 목록 — 각 항목에서 바로 허용 가능
  const ul = $('recent');
  ul.innerHTML = '';
  $('empty').style.display = local.recent.length ? 'none' : 'block';
  for (const item of local.recent.slice(0, 20)) {
    const li = document.createElement('li');
    const meta = document.createElement('div');
    meta.className = 'meta';
    const t = document.createElement('span');
    t.className = 't'; t.textContent = item.title || '(제목 없음)'; t.title = item.title || '';
    const c = document.createElement('span');
    c.className = 'c'; c.textContent = `${item.channel || '알 수 없음'} · ${item.reason || ''}`;
    meta.append(t, c);
    li.append(meta);
    if (item.channelId) {
      const btn = document.createElement('button');
      btn.textContent = '허용';
      btn.onclick = async () => {
        const { allowed, blocked } = await chrome.storage.sync.get({ allowed: {}, blocked: {} });
        allowed[item.channelId] = item.channel || item.channelId;
        delete blocked[item.channelId];
        await chrome.storage.sync.set({ allowed, blocked });
        render();
      };
      li.append(btn);
    }
    ul.append(li);
  }

  $('n-blocked').textContent = Object.keys(sync.blocked).length;
  $('n-allowed').textContent = Object.keys(sync.allowed).length;

  const map = tab === 'blocked' ? sync.blocked : sync.allowed;
  const cl = $('channels');
  cl.innerHTML = '';
  for (const [id, name] of Object.entries(map)) {
    const li = document.createElement('li');
    const meta = document.createElement('div');
    meta.className = 'meta';
    const t = document.createElement('span');
    t.className = 't'; t.textContent = name || id;
    meta.append(t);
    const btn = document.createElement('button');
    btn.textContent = '해제';
    btn.onclick = async () => {
      const key = tab;
      const cur = await chrome.storage.sync.get({ [key]: {} });
      delete cur[key][id];
      await chrome.storage.sync.set({ [key]: cur[key] });
      render();
    };
    li.append(meta, btn);
    cl.append(li);
  }
  if (!Object.keys(map).length) {
    const li = document.createElement('li');
    li.innerHTML = '<div class="meta"><span class="c">비어 있음</span></div>';
    cl.append(li);
  }
}

$('toggle').onchange = (e) => chrome.storage.sync.set({ enabled: e.target.checked }).then(render);
$('useSeed').onchange = (e) => chrome.storage.sync.set({ useSeed: e.target.checked });
for (const b of document.querySelectorAll('.tab')) {
  b.onclick = () => {
    tab = b.dataset.tab;
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
    render();
  };
}
render();
