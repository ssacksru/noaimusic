'use strict';
// 판별 사유는 내부 코드다. 화면에는 반드시 한국어로 번역되어 나가야 한다.
// 새 사유를 추가하고 라벨을 빼먹으면 여기서 잡힌다.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

// 코드가 실제로 만들어내는 reason 값을 모은다
function producedReasons() {
  const out = new Set();
  const src = read('src/heuristics.js') + read('src/content.js');
  for (const m of src.matchAll(/reason:\s*'([a-z-]+)'/g)) out.add(m[1]);
  for (const m of src.matchAll(/reason:\s*'(skipped:[a-z-]+)'/g)) out.add(m[1]);
  return out;
}

test('휴리스틱이 만드는 사유가 하나도 빠짐없이 존재한다', () => {
  const r = producedReasons();
  for (const expected of ['allowlist', 'blocklist', 'seed', 'not-music', 'music-clean', 'ai-negated', 'about-ai']) {
    assert.ok(r.has(expected), `사유 ${expected} 가 코드에서 사라졌다 — 테스트를 갱신하라`);
  }
});

test('화면에 노출되는 사유는 전부 한국어 라벨이 있다', () => {
  const popup = read('popup/popup.js');
  // 차단으로 이어져 목록에 찍히는 사유만 화면에 나온다
  const shown = ['youtube-ai-label', 'seed', 'blocklist'];
  for (const reason of shown) {
    const re = new RegExp(`base === '${reason}'\\)\\s*text = '[^']*[가-힣][^']*'`);
    assert.match(popup, re, `${reason} 의 한국어 라벨이 없다`);
  }
  assert.match(popup, /base\.startsWith\('keyword:'\)/, 'keyword: 접두 사유 처리가 없다');
  assert.match(popup, /startsWith\('skipped:'\)/, 'skipped: 접두 사유 처리가 없다');
});

test('팝업 화면 문구에 영문 내부 코드가 그대로 남아 있지 않다', () => {
  const html = read('popup/popup.html');
  const visible = html.replace(/<[^>]+>/g, ' ');
  for (const leak of ['youtube-ai-label', 'music-clean', 'not-music', 'blocklist', 'allowlist']) {
    assert.ok(!visible.includes(leak), `팝업 화면에 내부 코드 "${leak}" 가 노출된다`);
  }
});

test('팝업이 참조하는 요소 id 가 HTML 에 모두 있다', () => {
  const html = read('popup/popup.html');
  const js = read('popup/popup.js');
  const ids = new Set([...js.matchAll(/\$\('([\w-]+)'\)/g)].map((m) => m[1]));
  for (const id of ids) {
    assert.ok(html.includes(`id="${id}"`), `popup.js 가 없는 요소 #${id} 를 참조한다`);
  }
  assert.ok(ids.size >= 8, '검사한 id 가 너무 적다 — 정규식이 깨졌는지 확인하라');
});

test('건너뛴 뒤 알림(토스트)이 갖춰져 있다', () => {
  const js = read('src/content.js');
  const css = read('src/content.css');
  assert.match(js, /nam-toast/, '토스트를 만드는 코드가 없다');
  assert.match(js, /건너뛰었습니다/, '토스트 문구가 한국어가 아니다');
  assert.match(js, /되돌리기/, '되돌리기 버튼이 없다');
  assert.match(js, /document\.fullscreenElement/, '전체화면에서 토스트를 막는 처리가 없다');
  // 떠나는 페이지에서 소비하지 않도록 하는 가드 (없으면 토스트가 보이지 않는다)
  assert.match(js, /info\.v === new URLSearchParams/, '도착 페이지 판별 가드가 없다');
  assert.match(css, /#nam-toast\s*\{/, '토스트 스타일이 없다');
  assert.match(css, /position:\s*fixed/, '토스트가 고정 위치가 아니다');
});

test('페이지에 주입하는 요소는 nam- 접두사를 쓴다', () => {
  const js = read('src/content.js');
  const ids = [...js.matchAll(/\.id = '([\w-]+)'/g)].map((m) => m[1]);
  assert.ok(ids.length >= 2, '주입 요소를 못 찾았다');
  for (const id of ids) {
    assert.ok(id.startsWith('nam-'), `유튜브와 충돌할 수 있는 id: ${id}`);
  }
});
