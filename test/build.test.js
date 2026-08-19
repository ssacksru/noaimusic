'use strict';
// 크롬은 같은 파일 경로를 두 개의 월드(MAIN/ISOLATED)에 중복 주입하지 않는다(2026-08-19 실측).
// 그래서 격리 월드용 사본을 따로 둔다. 두 파일이 어긋나면 여기서 잡는다.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

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
