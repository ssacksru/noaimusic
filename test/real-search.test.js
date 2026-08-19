'use strict';
// 실측 검색 결과 20건 전수 판정 — 오탐/미탐이 생기면 여기서 잡힌다.
const { test } = require('node:test');
const assert = require('node:assert');
const H = require('../src/heuristics.js');
const { results } = require('./fixtures/search-ai-music.json');

const L = { allowed: {}, blocked: {}, seed: {} };
const verdict = (r) => H.evaluate({
  title: r.t, channel: r.c, channelId: r.id,
  durationSec: H.parseDuration(r.d), isPlaylist: !!r.playlist,
}, L);

test('실측 검색 결과 20건을 전부 정답대로 판정한다', () => {
  const wrong = results
    .map((r) => ({ r, v: verdict(r) }))
    .filter(({ r, v }) => v.action !== r.expect)
    .map(({ r, v }) => `  [${r.expect}→${v.action}/${v.reason}] ${r.t.slice(0, 45)}`);
  assert.equal(wrong.length, 0, '오판정:\n' + wrong.join('\n'));
});

test('실제 AI 플레이리스트 5건은 전부 잡힌다 (미탐 0)', () => {
  const blocked = results.filter((r) => r.expect === 'block');
  assert.equal(blocked.length, 5);
  for (const r of blocked) assert.equal(verdict(r).action, 'block', r.t);
});

test('"(NO AI)" 표기 영상은 차단하지 않는다', () => {
  const noai = results.find((r) => r.t.includes('NO AI'));
  assert.equal(verdict(noai).reason, 'ai-negated');
});

test('AI 음악을 설명하는 강의·정보 영상 4건은 통과시킨다', () => {
  const about = results.filter((r) => /알려드립니다|정리해|만들기|이유 3가지/.test(r.t));
  assert.equal(about.length, 4);
  for (const r of about) assert.equal(verdict(r).reason, 'about-ai', r.t);
});
