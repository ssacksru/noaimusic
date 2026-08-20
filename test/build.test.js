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
