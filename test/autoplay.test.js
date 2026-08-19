'use strict';
// page.js 를 가짜 window 위에서 실제로 로드해 자동재생 교정을 검증한다.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const vm = require('node:vm');
const H = require('../src/heuristics.js');

function loadPage() {
  const listeners = {};
  const posted = [];
  const win = {
    NAM_HEURISTICS: H,
    location: { origin: 'https://www.youtube.com' },
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    postMessage: (m) => posted.push(m),
    fetch: () => Promise.resolve({}),
  };
  win.window = win;
  vm.createContext(win);
  // vm 컨텍스트 안의 전역은 밖에서 넘긴 객체와 참조가 다르다 — 스크립트가 보는 window 를 꺼내온다
  const inner = vm.runInContext('window', win);
  vm.runInContext(fs.readFileSync(require.resolve('../src/page.js'), 'utf8'), win);
  return {
    win, posted,
    send: (data) => listeners.message.forEach((fn) => fn({ source: inner, data })),
    setInitial: (v) => { win.ytInitialData = v; return win.ytInitialData; },
  };
}

const vid = (id, title, channel) => ({
  compactVideoRenderer: {
    videoId: id, title: { simpleText: title },
    longBylineText: { runs: [{ text: channel, navigationEndpoint: { browseEndpoint: { browseId: 'UC' + id } } }] },
    lengthText: { simpleText: '1:30:00' },
  },
});

function watchNextFixture(autoplayId) {
  return {
    contents: {
      twoColumnWatchNextResults: {
        secondaryResults: {
          secondaryResults: {
            results: [
              vid('ai1', 'AI로 만든 감성 발라드 노래모음', 'AI뮤직'),
              vid('ok1', '아이유 노래모음 광고없이', '띵곡저장소'),
              vid('ok2', '90년대 발라드 플레이리스트', '추억창고'),
            ],
          },
        },
        autoplay: {
          autoplay: {
            sets: [{
              autoplayVideo: { watchEndpoint: { videoId: autoplayId } },
              nextButtonVideo: { watchEndpoint: { videoId: autoplayId } },
            }],
          },
        },
      },
    },
  };
}

test('자동재생 대상이 AI면 살아남은 정상 영상으로 교체된다 (끊김 없음)', () => {
  const p = loadPage();
  const data = p.setInitial(watchNextFixture('ai1'));
  const sets = data.contents.twoColumnWatchNextResults.autoplay.autoplay.sets[0];
  const results = data.contents.twoColumnWatchNextResults.secondaryResults.secondaryResults.results;

  assert.equal(results.length, 2, 'AI 항목이 사이드바에서 제거됨');
  assert.equal(results[0].compactVideoRenderer.videoId, 'ok1');
  assert.equal(sets.autoplayVideo.watchEndpoint.videoId, 'ok1', '자동재생이 다음 정상 영상으로 승계');
  assert.equal(sets.nextButtonVideo.watchEndpoint.videoId, 'ok1');
});

test('자동재생 대상이 정상이면 건드리지 않는다', () => {
  const p = loadPage();
  const data = p.setInitial(watchNextFixture('ok1'));
  const sets = data.contents.twoColumnWatchNextResults.autoplay.autoplay.sets[0];
  assert.equal(sets.autoplayVideo.watchEndpoint.videoId, 'ok1');
});

test('걸러낸 항목이 통계로 보고된다', () => {
  const p = loadPage();
  p.setInitial(watchNextFixture('ai1'));
  const msg = p.posted.find((m) => m.type === 'NAM_REMOVED');
  assert.ok(msg, 'NAM_REMOVED 메시지 발신');
  assert.equal(msg.items.length, 1);
  assert.equal(msg.items[0].channel, 'AI뮤직');
});

test('사용자 허용목록이 page 로 전달되면 즉시 반영', () => {
  const p = loadPage();
  p.send({ type: 'NAM_LISTS', enabled: true, lists: { allowed: { UCai1: 1 }, blocked: {}, seed: {} } });
  const data = p.setInitial(watchNextFixture('ai1'));
  const results = data.contents.twoColumnWatchNextResults.secondaryResults.secondaryResults.results;
  assert.equal(results.length, 3, '허용된 채널은 그대로 남는다');
});

test('꺼져 있으면 아무것도 필터하지 않는다', () => {
  const p = loadPage();
  p.send({ type: 'NAM_LISTS', enabled: false, lists: { allowed: {}, blocked: {}, seed: {} } });
  const data = p.setInitial(watchNextFixture('ai1'));
  const results = data.contents.twoColumnWatchNextResults.secondaryResults.secondaryResults.results;
  assert.equal(results.length, 3);
});

test('시드 채널 ID로 차단된다', () => {
  const p = loadPage();
  p.send({ type: 'NAM_LISTS', enabled: true, lists: { allowed: {}, blocked: {}, seed: { UCok2: 1 } } });
  const data = p.setInitial(watchNextFixture('ok1'));
  const results = data.contents.twoColumnWatchNextResults.secondaryResults.secondaryResults.results;
  assert.equal(results.length, 1, 'AI 휴리스틱 1건 + 시드 1건 제거');
  assert.equal(results[0].compactVideoRenderer.videoId, 'ok1');
});

test('깨진 데이터가 들어와도 예외를 던지지 않는다', () => {
  const p = loadPage();
  assert.doesNotThrow(() => p.setInitial({ contents: { twoColumnWatchNextResults: null } }));
  assert.doesNotThrow(() => p.setInitial(null));
  assert.doesNotThrow(() => p.setInitial('문자열'));
});
