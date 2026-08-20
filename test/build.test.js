'use strict';
// 크롬은 같은 파일 경로를 두 개의 월드(MAIN/ISOLATED)에 중복 주입하지 않는다(2026-08-19 실측).
// 그래서 격리 월드용 사본을 따로 둔다. 두 파일이 어긋나면 여기서 잡는다.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('heuristics.iso.js 는 heuristics.js 와 완전히 동일해야 한다', () => {
  const a = fs.readFileSync(path.join(root, 'src/heuristics.js'), 'utf8');
  const b = fs.readFileSync(path.join(root, 'src/heuristics.iso.js'), 'utf8');
  assert.equal(b, a, 'npm run sync 를 실행해 사본을 갱신하라');
});

test('manifest 는 두 월드에 서로 다른 파일 경로를 준다', () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const main = m.content_scripts.find((c) => c.world === 'MAIN');
  const iso = m.content_scripts.find((c) => c.world !== 'MAIN');
  assert.ok(main && iso, 'MAIN/ISOLATED 콘텐츠 스크립트가 모두 있어야 한다');
  const overlap = main.js.filter((f) => iso.js.includes(f));
  assert.deepEqual(overlap, [], '같은 파일을 두 월드에 넣으면 한쪽이 주입되지 않는다');
});

test('manifest 에 _locales 없이 default_locale 을 넣지 않는다', () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  if (m.default_locale) {
    assert.ok(fs.existsSync(path.join(root, '_locales', m.default_locale, 'messages.json')),
      'default_locale 선언 시 _locales 트리가 없으면 확장이 로드되지 않는다');
  }
});

test('manifest 가 참조하는 파일이 모두 존재한다', () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const files = [
    m.background.service_worker,
    m.action.default_popup,
    ...Object.values(m.icons),
    ...m.content_scripts.flatMap((c) => [...(c.js || []), ...(c.css || [])]),
    ...m.web_accessible_resources.flatMap((w) => w.resources),
  ];
  for (const f of files) {
    assert.ok(fs.existsSync(path.join(root, f)), `manifest 가 없는 파일을 참조한다: ${f}`);
  }
});

test('차단·허용 목록을 storage.sync 에 저장하지 않는다', () => {
  // sync 는 항목당 8KB — 채널 100여 개에서 저장이 조용히 실패한다(2026-08-20 실측).
  const files = ['src/content.js', 'popup/popup.js', 'src/lists.js'];
  for (const f of files) {
    const src = read(f);
    const bad = [...src.matchAll(/chrome\.storage\.sync\.set\(\{([^}]*)\}/g)]
      .map((m) => m[1])
      .filter((args) => /\b(blocked|allowed)\b/.test(args));
    assert.deepEqual(bad, [], `${f} 가 목록을 sync 에 저장한다 — local 을 써야 한다`);
  }
});

test('구버전 sync 목록을 local 로 옮기는 경로가 있다', () => {
  const src = read('src/lists.js');
  assert.match(src, /listsMigrated/, '마이그레이션 완료 표시가 없다');
  assert.match(src, /chrome\.storage\.sync\.get/, '구버전 sync 목록을 읽지 않는다');
  assert.match(src, /chrome\.storage\.sync\.remove/, '옮긴 뒤 sync 를 비우지 않는다');
});

test('목록 모듈이 필요한 곳에 모두 실린다', () => {
  const m = JSON.parse(read('manifest.json'));
  const iso = m.content_scripts.find((c) => c.world !== 'MAIN');
  assert.ok(iso.js.includes('src/lists.js'), '콘텐츠 스크립트에 lists.js 가 없다');
  assert.ok(read('popup/popup.html').includes('src/lists.js'), '팝업에 lists.js 가 없다');
  // MAIN world 는 목록을 직접 읽지 않는다 (content 가 postMessage 로 내려준다)
  const main = m.content_scripts.find((c) => c.world === 'MAIN');
  assert.ok(!main.js.includes('src/lists.js'), 'MAIN world 에는 필요 없다');
});

test('빌드 스크립트가 파일 목록을 manifest 에서 유도한다', () => {
  // 손으로 적으면 새 파일을 빠뜨린다 — 실제로 lists.js 가 zip 에서 누락된 적이 있다(2026-08-20).
  const sh = read('tools/build.sh');
  assert.match(sh, /require\("\.\/manifest\.json"\)/, 'manifest 를 읽지 않는다');
  assert.ok(!/src\/heuristics\.js src\/|zip -qr .* src\/page\.js/.test(sh),
    '빌드 스크립트에 파일 경로가 하드코딩되어 있다');
  assert.match(sh, /default_popup/, '팝업이 부르는 파일을 따라가지 않는다');
});

test('팝업 HTML 이 부르는 로컬 파일이 모두 존재한다', () => {
  const p = JSON.parse(read('manifest.json')).action.default_popup;
  const html = read(p);
  const dir = path.dirname(path.join(root, p));
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1])
    .filter((u) => !/^https?:|^data:/.test(u));
  assert.ok(refs.length >= 2, '팝업이 부르는 파일을 못 찾았다');
  for (const u of refs) {
    assert.ok(fs.existsSync(path.join(dir, u)), `팝업이 없는 파일을 부른다: ${u}`);
  }
});

test('수집기가 판정 불가를 "AI 아님" 으로 세지 않는다', () => {
  // 유튜브는 대량 요청 뒤 fetch 를 막는다. 그때 실패를 정상으로 세면
  // 수집 결과 전체가 조용히 거짓이 된다(2026-08-20 실측 — 신규 0개로 나왔다).
  const src = read('tools/harvest.js');
  assert.match(src, /badges === null/, '판정 불가를 구분하지 않는다');
  assert.ok(!/\(verdict\.badges \|\| \[\]\)/.test(src), '실패를 빈 배열로 뭉개고 있다');
  assert.match(src, /요청이 막힌/, '연속 실패 시 중단하는 처리가 없다');
});

test('시청 페이지 확인에 쿠키를 실어 보낸다', () => {
  // credentials:'omit' 으로 요청하면 유튜브가 시청 페이지를 거부한다
  // (실측 2026-08-20: omit 실패, 기본값 200). 이걸 놓치면 학습이 통째로 죽는다.
  const b = read('src/badges.js');
  assert.match(b, /fetch\('https:\/\/www\.youtube\.com\/watch\?v=' \+ videoId\)/,
    '시청 페이지 요청에 옵션을 붙이면 안 된다');
  assert.ok(!/credentials:\s*.omit./.test(b), "credentials:'omit' 을 쓰면 유튜브가 거부한다");
  assert.ok(!/credentials:\s*.omit./.test(read('src/background.js')),
    '서비스워커에 쿠키 없는 시청 페이지 요청이 남아 있다');
});

test('프로파일링을 페이지 컨텍스트에서 한다', () => {
  // 서비스워커에서 하면 쿠키가 실리지 않아 전부 실패한다
  const c = read('src/content.js');
  assert.match(c, /NAM_BADGES\.checkVideo/, '페이지에서 직접 확인하지 않는다');
  const m = JSON.parse(read('manifest.json'));
  const iso = m.content_scripts.find((x) => x.world !== 'MAIN');
  assert.ok(iso.js.includes('src/badges.js'), '콘텐츠 스크립트에 badges.js 가 없다');
});

test('학습 후보가 실패해도 사라지지 않는다', () => {
  // 실패한 후보가 큐에서 증발하면 그 페이지에서는 영영 다시 시도하지 않는다
  const c = read('src/content.js');
  assert.match(c, /const wanted = new Map\(\)/, '미처리 후보를 보관하지 않는다');
  assert.match(c, /pausedUntil/, '연속 실패 시 쉬는 처리가 없다');
  assert.match(c, /wanted\.delete\(channelId\)/, '판정을 받은 뒤 정리하지 않는다');
  assert.match(c, /setInterval\(/, '주기적으로 다시 시도하지 않는다');
});

test('학습 결과가 이미 그려진 카드에도 반영된다', () => {
  // 한 번 검사한 카드를 다시 안 보면, 학습해도 화면에 그대로 남는다 (2026-08-20 실측)
  const c = read('src/content.js');
  assert.match(c, /function resweep\(\)/, '재판정 함수가 없다');
  assert.match(c, /delete el\.dataset\.namChecked/, '검사 표시를 지우지 않는다');
});

test('화면 카드가 채널 ID 를 알 수 있게 매핑을 넘긴다', () => {
  // 검색·피드 카드는 채널을 /@handle 로만 링크해 채널 ID 를 알 수 없다.
  // 매핑이 없으면 학습한 채널과 대조할 수 없어 화면에서 안 사라진다.
  assert.match(read('src/heuristics.js'), /idMap\[meta\.videoId\] = meta\.channelId/, '매핑을 수집하지 않는다');
  assert.match(read('src/page.js'), /NAM_IDMAP/, '매핑을 넘기지 않는다');
  assert.match(read('src/content.js'), /videoChannel\[videoId\]/, '매핑을 쓰지 않는다');
});

test('재생목록 ID 를 시청 페이지로 열려고 하지 않는다', () => {
  // PL/RD/OLAK 로 watch?v= 를 요청하면 계속 실패해 학습이 멈춘다 (2026-08-20 실측)
  assert.match(read('src/content.js'), /\^\[\\w-\]\{11\}\$/, '영상 ID 형식을 확인하지 않는다');
});

test('추정 신호는 유튜브 공시와 구분되고 끌 수 있다', () => {
  // 추정은 조회수+해시태그 조합(검출 39%·오탐 0.8%) — 사용자가 구분하고 끌 수 있어야 한다
  const b = read('src/badges.js');
  assert.match(b, /COMBO_VIEWS_MAX = 3000/, '조회수 기준이 실측값과 다르다');
  assert.match(b, /COMBO_HASHTAG_MIN = 12/, '해시태그 기준이 실측값과 다르다');
  assert.match(b, /views != null/, '조회수를 모르면 추정하지 않아야 한다 (폴백 오탐 6.9% 실측)');
  assert.match(b, /reason: 'hashtags'/, '근거를 구분해 돌려주지 않는다');
  assert.match(b, /reason: 'label'/, '유튜브 공시 근거를 표시하지 않는다');
  assert.match(b, /useGuess/, '추정 신호를 끌 수 없다');

  const html = read('popup/popup.html');
  assert.match(html, /id="useGuess"/, '팝업에 추정 끄기 옵션이 없다');
  assert.match(read('popup/popup.js'), /정황으로 추정/, '추정으로 잡은 채널을 표시하지 않는다');
});

test('학습 순서를 조회수로 정한다', () => {
  // 확인은 동시에 두 개씩만 가능하므로 순서가 곧 속도다.
  // 조회수 5천 미만이면 AI 86% · 사람 3% (2026-08-20 실측) — 차단 근거로는 신생
  // 창작자를 막으므로 쓰지 않고, 순서를 정하는 데만 쓴다.
  const c = read('src/content.js');
  assert.match(c, /function byPriority\(\)/, '우선순위 정렬이 없다');
  assert.match(c, /views/, '조회수를 쓰지 않는다');
  assert.match(read('src/heuristics.js'), /function parseViews/, '조회수 파싱이 없다');
});
