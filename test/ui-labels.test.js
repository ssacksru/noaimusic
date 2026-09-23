'use strict';
// 판별 사유는 내부 코드다. 화면에는 반드시 _locales 번역을 거쳐 나가야 한다.
// 새 사유를 추가하고 라벨을 빼먹으면 여기서 잡힌다.
const { test, describe } = require('node:test');
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

test('화면에 노출되는 사유는 전부 번역 라벨이 있다', () => {
  const popup = read('popup/popup.js');
  // 차단으로 이어져 목록에 찍히는 사유만 화면에 나온다
  const shown = ['youtube-ai-label', 'seed', 'blocklist'];
  for (const reason of shown) {
    const re = new RegExp(`base === '${reason}'\\)\\s*text = t\\('\\w+'\\)`);
    assert.match(popup, re, `${reason} 의 번역 라벨이 없다`);
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
  assert.match(js, /t\('toastSkipped'\)/, '토스트 문구가 번역을 거치지 않는다');
  assert.match(js, /t\('toastUndo'\)/, '되돌리기 버튼이 없다');
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

test('키보드 포커스가 보이게 되어 있다', () => {
  const css = read('popup/popup.css');
  assert.match(css, /:focus-visible/, '포커스 표시 규칙이 없다');
  assert.match(css, /\.switch input:focus-visible \+ \.slider/,
    '스위치는 투명한 체크박스라 슬라이더에 포커스를 옮겨야 한다');
  assert.match(css, /outline:\s*2px solid/, '포커스 윤곽선이 없다');
});

test('AI 배지 판별이 언어에 의존하지 않는다', () => {
  // 라벨은 로케일마다 다르다: AI(ko/en/ja) · IA(es/fr/pt) · KI(de) · ИИ(ru) · एआई(hi) (실측 2026-08-20)
  const bd = read('src/badges.js');
  assert.match(bd, /iconType === 'INFO'/, '아이콘 종류로 판별하지 않는다');
  assert.match(bd, /BADGE_STYLE_TYPE_SIMPLE/, '배지 스타일을 확인하지 않는다');
  assert.ok(!/badges\.some\(\(l\) => \/\^AI\$\/i/.test(bd), '아직 "AI" 글자에 의존한다');

  const page = read('src/page.js');
  assert.match(page, /iconType === 'INFO'/, 'page.js 가 글자에 의존한다');

  const content = read('src/content.js');
  assert.ok(!/AI로 생성된\|AI-generated/.test(content), 'DOM 판별이 한국어·영어 문구에 묶여 있다');
});

test('시청 페이지 배지 판별이 "인증됨" 같은 다른 배지를 거른다', () => {
  // 일반 영상에도 같은 자리에 인증 배지가 온다 (2026-08-20 실측: KBS 방송 영상)
  const js = read('src/content.js');
  assert.match(js, /NOT_AI_BADGE/, '비-AI 배지 제외 목록이 없다');
  assert.match(js, /인증\|verified/, '인증 배지를 제외하지 않는다');
  assert.match(js, /aria-label/, 'aria 라벨도 함께 보지 않는다');
});

test('걸러낸 항목을 눌러 볼 수 있고, 그때는 건너뛰지 않는다', () => {
  const pj = read('popup/popup.js');
  assert.match(pj, /openWithPass/, '팝업에 눌러서 보기가 없다');
  assert.match(pj, /viewPass/, '통행증을 발급하지 않는다');
  assert.match(pj, /t\('openHint'\)/, '차단이 유지된다는 안내가 없다');
  assert.match(read('_locales/ko/messages.json'), /차단은 유지됨/, '안내 문구가 바뀌었다');
  const c = read('src/content.js');
  assert.match(c, /function passActive/, '통행증 확인이 없다');
  assert.match(c, /!passActive\(curV, meta\.channelId\)/, '통행증이 건너뛰기를 막지 않는다');
  assert.match(c, /10 \* 60 \* 1000/.test(pj) ? /passActive/ : /NEVER/, '통행증에 만료가 없다');
});

test('후원 링크는 링크가 있을 때만, 팝업 안에서만 보인다', () => {
  // 유튜브 페이지 주입은 정책 위험 — 후원 노출은 팝업 전용.
  // 빈 링크로 죽은 버튼을 배포하는 사고 방지: 비면 줄 자체가 숨는다.
  const js = read('popup/popup.js');
  assert.match(js, /const DONATE_GLOBAL = /, '후원 링크 상수가 없다');
  assert.match(js, /if \(!DONATE_GLOBAL && !DONATE_KR\) return;/, '링크가 비어도 후원 줄이 보인다');
  const html = read('popup/popup.html');
  assert.match(html, /id="donate"[^>]*display:none/, '기본 상태가 숨김이 아니다');
  // 콘텐츠 스크립트에는 후원 관련 코드가 없어야 한다
  assert.ok(!/donate|후원/i.test(read('src/content.js')), '유튜브 페이지에 후원이 노출된다');
});

test('확장이 끼워 넣는 UI 는 data-nam-ui 표식을 단다', () => {
  // Couch Remote(TV 리모컨)의 유튜브 어댑터가 [data-nam-ui] 를 D-pad 포커스 후보에서 뺀다.
  // 표식이 빠지면 리모컨 포커스가 토스트·배너 버튼으로 튄다 (2026-09-14 교차 점검).
  const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'content.js'), 'utf8');
  assert.match(js, /el\.dataset\.namUi = 'toast'/, '토스트에 표식이 없다');
  assert.match(js, /bar\.dataset\.namUi = 'banner'/, '배너에 표식이 없다');
  assert.match(js, /webkitFullscreenElement/, 'Safari 전체화면(webkit) 검사가 없다');
});

// Mac App Store 거절(가이드라인 4, 2026-09-22): 영어 환경 심사기에서 팝업이 한국어로 떴다.
// 화면 문구는 전부 _locales 를 거쳐야 하고, 두 언어의 키가 어긋나면 안 된다.
describe('다국어', () => {
  const en = JSON.parse(read('_locales/en/messages.json'));
  const ko = JSON.parse(read('_locales/ko/messages.json'));
  const hangul = /[\uAC00-\uD7A3]/;
  const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');

  test('en·ko 가 같은 키를 가진다', () => {
    assert.deepStrictEqual(Object.keys(en).sort(), Object.keys(ko).sort());
  });

  test('영어 문구에 한국어가 섞이지 않았다', () => {
    for (const [k, v] of Object.entries(en)) assert.ok(!hangul.test(v.message), `en.${k} 에 한국어가 있다`);
  });

  test('코드가 부르는 키가 전부 있다', () => {
    const html = read('popup/popup.html');
    const js = read('popup/popup.js') + read('src/content.js');
    const keys = [...html.matchAll(/data-i18n="(\w+)"/g), ...js.matchAll(/\bt\('(\w+)'/g)].map((m) => m[1]);
    assert.ok(keys.length >= 40, `찾은 키가 너무 적다(${keys.length}) — 정규식 확인`);
    for (const k of keys) assert.ok(en[k] && ko[k], `번역 키 ${k} 가 없다`);
  });

  test('치환 자리는 {1} 로 쓰고, 두 언어가 같이 가진다', () => {
    // 브라우저 치환($1·placeholders)은 Safari 에서 앞 글자째 값이 지워진다(2026-09-23 실측) — 쓰지 않는다
    for (const k of Object.keys(en)) {
      for (const msgs of [en, ko]) {
        assert.ok(!/\$/.test(msgs[k].message) && !msgs[k].placeholders, `${k} 가 브라우저 치환을 쓴다`);
      }
      assert.strictEqual(en[k].message.includes('{1}'), ko[k].message.includes('{1}'), `${k} 의 {1} 자리가 언어마다 다르다`);
    }
  });

  test('팝업 안에서 번역 함수 t 를 가리는 지역 변수가 없다', () => {
    // row() 의 const t = span 이 t() 를 가려 목록 그리기가 통째로 죽은 적이 있다(2026-09-23)
    assert.ok(!/\b(const|let|var)\s+t\s*=(?!\s*\(key)/.test(read('popup/popup.js') + read('src/content.js')), 't 를 다른 값으로 가린다');
  });

  test('팝업·페이지 UI 에 한국어를 직접 쓰지 않는다', () => {
    for (const f of ['popup/popup.html', 'popup/popup.js']) {
      assert.ok(!hangul.test(stripComments(read(f))), `${f} 에 번역을 거치지 않은 한국어가 있다`);
    }
    // content.js 는 유튜브 한국어 화면을 읽는 정규식(조회수·인증)이 있어 문구 대입만 본다
    const c = stripComments(read('src/content.js'));
    assert.ok(!/(textContent|innerHTML|innerText)\s*=[^;]*[\uAC00-\uD7A3]/.test(c), 'content.js 가 한국어 문구를 직접 넣는다');
  });
});
