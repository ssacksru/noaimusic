'use strict';
const $ = (id) => document.getElementById(id);

// 후원 링크 — 비워두면 후원 줄 자체가 표시되지 않는다.
// 기능은 아무것도 잠그지 않는다(웹스토어 '무료' 신고 유지 조건).
const DONATE_GLOBAL = '';   // 예: https://github.com/sponsors/<계정>
const DONATE_KR = '';       // 예: https://toss.me/<토스아이디>
let tab = 'learned';

// 화면 문구는 전부 _locales 에서 온다 — 브라우저 언어와 다른 언어가 섞여 나가면
// Mac App Store 가 거절한다(가이드라인 4, 2026-09-22: 영어 환경에서 한국어 팝업).
// {1} 치환은 직접 한다 — Safari 의 getMessage 치환은 "($1)" 같은 자리에서 값을 앞 글자째 지운다(실측 2026-09-23)
const t = (key, sub) => chrome.i18n.getMessage(key).replace('{1}', () => String(sub));
const UI_LANG = chrome.i18n.getUILanguage();
const num = (n) => Number(n).toLocaleString(UI_LANG);
document.documentElement.lang = UI_LANG;
for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);

function today() { return new Date().toISOString().slice(0, 10); }

// 판별 사유를 사람이 읽는 말로. 화면에 내부 코드가 새어나오지 않게 한다.
function reasonLabel(reason) {
  const r = String(reason || '');
  const skipped = r.startsWith('skipped:');
  const base = skipped ? r.slice(8) : r;
  let text;
  if (base === 'youtube-ai-label') text = t('reasonYoutubeLabel');
  else if (base === 'seed') text = t('reasonSeed');
  else if (base === 'blocklist') text = t('reasonBlocklist');
  else if (base.startsWith('keyword:')) text = t('reasonKeyword', base.slice(8));
  else if (base.startsWith('mix:')) text = t('reasonMix', base.slice(4));
  else text = base;
  return skipped ? t('reasonSkipped', text) : text;
}

function timeAgo(ts) {
  if (!ts) return '';
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return t('agoNow');
  if (m < 60) return t('agoMin', m);
  const h = Math.floor(m / 60);
  if (h < 24) return t('agoHour', h);
  return t('agoDay', Math.floor(h / 24));
}

// 걸러낸 것을 눌러 "이번만 보기" — 10분짜리 통행증을 끊고 연다.
// 목록은 그대로 유지되므로 차단은 풀리지 않는다.
async function openWithPass(url, videoId, channelId) {
  await chrome.storage.local.set({
    viewPass: { videoId: videoId || '', channelId: channelId || '', until: Date.now() + 10 * 60 * 1000 },
  });
  chrome.tabs.create({ url });
}

function row(title, sub, btnText, onClick, openTo) {
  const li = document.createElement('li');
  const meta = document.createElement('div');
  meta.className = 'meta';
  const ti = document.createElement('span');
  ti.className = 't'; ti.textContent = title; ti.title = title;
  const c = document.createElement('span');
  c.className = 'c'; c.textContent = sub;
  meta.append(ti, c);
  li.append(meta);
  if (openTo) {
    meta.classList.add('link');
    meta.title = t('openHint');
    meta.onclick = openTo;
  }
  if (btnText) {
    const btn = document.createElement('button');
    btn.textContent = btnText;
    btn.onclick = onClick;
    li.append(btn);
  }
  return li;
}

async function allowChannel(channelId, name) {
  await NAM_LISTS.setChannel(channelId, name, 'allowed');
  // 학습 결과도 함께 지운다 — 그러지 않으면 다시 AI로 판정된다
  const { profiles, profileNames } = await chrome.storage.local.get({ profiles: {}, profileNames: {} });
  delete profiles[channelId]; delete profileNames[channelId];
  await chrome.storage.local.set({ profiles, profileNames });
  render();
}

async function render() {
  const sync = await chrome.storage.sync.get({ enabled: true, useSeed: true, autoSkip: true, useGuess: true });
  const local = await chrome.storage.local.get({
    stats: { day: today(), count: 0, total: 0 }, recent: [], profiles: {}, profileNames: {}, profileWhy: {},
  });
  const mine = await NAM_LISTS.getLists();

  $('toggle').checked = sync.enabled;
  $('useSeed').checked = sync.useSeed;
  $('autoSkip').checked = sync.autoSkip;
  $('useGuess').checked = sync.useGuess;
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
  $('recent-hint').textContent = local.recent.length > 4 ? t('recentHint', local.recent.length) : '';
  for (const item of local.recent.slice(0, 30)) {
    const sub = `${item.channel || t('unknownChannel')} · ${reasonLabel(item.reason)}${item.at ? ' · ' + timeAgo(item.at) : ''}`;
    ul.append(row(item.title || t('untitled'), sub,
      item.channelId ? t('btnAllow') : null,
      () => allowChannel(item.channelId, item.channel),
      item.videoId && !/^(RD|PL|OLAK)/.test(item.videoId)
        ? () => openWithPass('https://www.youtube.com/watch?v=' + item.videoId, item.videoId, item.channelId)
        : null));
  }

  // 학습됨 = 프로파일링·재생 중 판별로 스스로 알아낸 채널
  const learned = Object.keys(local.profiles).filter((id) => local.profiles[id] === 'ai');
  $('n-learned').textContent = learned.length;
  $('n-blocked').textContent = Object.keys(mine.blocked).length;
  $('n-allowed').textContent = Object.keys(mine.allowed).length;

  const NOTE = {
    learned: t('noteLearned'),
    blocked: t('noteBlocked'),
    allowed: t('noteAllowed'),
  };
  $('tabnote').textContent = NOTE[tab];

  const cl = $('channels');
  cl.innerHTML = '';
  const all = tab === 'learned'
    ? learned.map((id) => [id, local.profileNames[id] || id,
        local.profileWhy[id] === 'hashtags' ? t('subGuessed') : null])
    : Object.entries(tab === 'blocked' ? mine.blocked : mine.allowed);
  // 보이는 건 몇 줄뿐이라 전부 그릴 이유가 없다 (채널이 수천 개까지 쌓인다)
  const LIST_CAP = 100;
  const entries = all.slice(0, LIST_CAP);

  const SUB = {
    learned: t('subLearned'),
    blocked: t('subBlocked'),
    allowed: t('subAllowed'),
  };
  for (const [id, name, note] of entries) {
    cl.append(row(name || id, note || SUB[tab], tab === 'allowed' ? t('btnRemove') : t('btnAllow'), async () => {
      if (tab === 'allowed') {
        await NAM_LISTS.setChannel(id, name, null);
        render();
      } else {
        allowChannel(id, name);
      }
    }, () => openWithPass('https://www.youtube.com/channel/' + id, '', id)));
  }
  if (!entries.length) {
    const li = document.createElement('li');
    const d = document.createElement('div');
    d.className = 'meta';
    const c = document.createElement('span');
    c.className = 'c';
    c.textContent = t('listEmpty');
    d.append(c); li.append(d); cl.append(li);
  } else if (all.length > entries.length) {
    const li = document.createElement('li');
    const d = document.createElement('div');
    d.className = 'meta';
    const c = document.createElement('span');
    c.className = 'c';
    c.textContent = t('listMore', num(all.length - entries.length));
    d.append(c); li.append(d); cl.append(li);
  }

  // 더 있는 목록은 아래를 흐리게 해 스크롤을 알린다 (반쯤 잘린 행처럼 보이지 않게)
  for (const el of [ul, cl]) el.classList.toggle('more', el.scrollHeight > el.clientHeight + 2);
}

$('toggle').onchange = (e) => chrome.storage.sync.set({ enabled: e.target.checked }).then(render);
$('useSeed').onchange = (e) => chrome.storage.sync.set({ useSeed: e.target.checked });
$('useGuess').onchange = (e) => chrome.storage.sync.set({ useGuess: e.target.checked });
$('autoSkip').onchange = (e) => chrome.storage.sync.set({ autoSkip: e.target.checked });
for (const b of document.querySelectorAll('.tab')) {
  b.onclick = () => {
    tab = b.dataset.tab;
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
    render();
  };
}

// 지금 보는 채널 — 유튜브 공시도 정황 신호도 없는 AI 채널(실사용 제보 2026-08-21)은
// 자동으로 못 잡는다. 보고 있는 사람이 가장 정확한 판별자다 — 그 판단을 원클릭으로 받는다.
async function renderNow() {
  try {
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!t || !/^https:\/\/www\.youtube\.com\/watch/.test(t.url || '')) return;
    const meta = await chrome.tabs.sendMessage(t.id, { type: 'NAM_GET_WATCH' });
    if (!meta || !/^UC[\w-]{22}$/.test(meta.channelId || '')) return;
    const mine = await NAM_LISTS.getLists();
    const { profiles } = await chrome.storage.local.get({ profiles: {} });
    if (mine.blocked[meta.channelId] || profiles[meta.channelId] === 'ai') return;
    $('now').style.display = '';
    $('now-name').textContent = meta.channel || meta.channelId;
    $('now-block').onclick = async () => {
      await NAM_LISTS.setChannel(meta.channelId, meta.channel, 'blocked');
      $('now').style.display = 'none';
      render();
    };
  } catch (e) { /* 시청 페이지가 아니거나 스크립트 미주입 — 조용히 숨긴다 */ }
}
renderNow();

// 후원 줄 — 링크가 하나라도 있어야 보이고, 없는 쪽은 감춘다
(() => {
  if (!DONATE_GLOBAL && !DONATE_KR) return;
  $('donate').style.display = '';
  if (DONATE_GLOBAL) $('donate-global').href = DONATE_GLOBAL;
  else $('donate-global').style.display = 'none';
  if (DONATE_KR) $('donate-kr').href = DONATE_KR;
  else $('donate-kr').style.display = 'none';
  if (!DONATE_GLOBAL || !DONATE_KR) $('donate-sep').style.display = 'none';
})();

// 번들된 목록 개수는 파일에서 직접 읽어 화면과 데이터가 어긋나지 않게 한다
(async () => {
  let n = 0;
  for (const f of ['data/seed-channels.json', 'data/ai-channels.json']) {
    try {
      const r = await fetch(chrome.runtime.getURL(f));
      n += Object.keys((await r.json()).channels || {}).length;
    } catch (e) { /* 없으면 건너뛴다 */ }
  }
  $('seed-count').textContent = t('seedCount', num(n));
})();

render();
