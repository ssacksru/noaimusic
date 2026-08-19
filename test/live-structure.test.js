'use strict';
// 실측 데이터 회귀 테스트 — 2026-08-19 youtube.com 홈에서 추출한 실제 카드 구조.
// 유튜브가 구조를 바꾸면 여기서 먼저 깨진다.
const { test } = require('node:test');
const assert = require('node:assert');
const H = require('../src/heuristics.js');
const fixture = require('./fixtures/home-lockup.json');

const cards = fixture.cards;
const L = { allowed: {}, blocked: {}, seed: {} };

test('실측: lockupViewModel 에서 제목·채널·채널ID·길이를 뽑는다', () => {
  const m = H.metaFromItem(cards[0]);
  assert.equal(m.title, '8월 19일(수) 두산 vs NC | 2026 정규시즌 H/L');
  assert.equal(m.channel, 'BEARS TV');
  assert.equal(m.channelId, 'UCsebzRfMhwYfjeBIxNX1brg');
  assert.equal(m.durationSec, 943, '길이 배지 15:43 파싱 — 경로가 바뀌면 실패');
  assert.equal(m.isPlaylist, false);
});

test('실측: 채널 링크 없는 믹스 카드도 채널명 폴백으로 읽는다', () => {
  const m = H.metaFromItem(cards[1]);
  assert.match(m.title, /^믹스 - RESCENE/);
  assert.equal(m.channelId, '', '믹스 카드엔 browseId 가 없다');
  assert.equal(m.channel, 'RESCENE (리센느), 아이오아이, 에스파 등', '폴백으로 첫 행 텍스트 사용');
  assert.equal(m.isPlaylist, true);
});

test('실측: 라이브 배지는 길이 0 으로 처리된다', () => {
  assert.equal(H.metaFromItem(cards[2]).durationSec, 0);
});

test('실측: 1시간 넘는 예능 영상도 음악이 아니면 통과', () => {
  const m = H.metaFromItem(cards[3]);
  assert.equal(m.durationSec, 7026);
  assert.equal(H.evaluate(m, L).reason, 'not-music', '긴 영상이라는 이유만으로 차단하면 안 된다');
});

test('실측 카드 전체를 filterTree 에 넣어도 정상 영상은 하나도 안 사라진다', () => {
  const data = { contents: cards.map((c) => JSON.parse(JSON.stringify(c))) };
  const removed = H.filterTree(data, L);
  assert.equal(removed.length, 0, '실제 홈 피드의 일반 영상은 전부 보존되어야 한다');
  assert.equal(data.contents.length, cards.length);
});

test('실측 구조에 AI 음악 카드를 넣으면 그것만 제거된다', () => {
  const aiCard = JSON.parse(JSON.stringify(cards[0]));
  const md = aiCard.lockupViewModel.metadata.lockupMetadataViewModel;
  md.title.content = 'AI가 만든 감성 발라드 노래모음 | 광고없는 플레이리스트';
  md.metadata.contentMetadataViewModel.metadataRows[0].metadataParts[0].text.content = 'AI 뮤직랩';
  const data = { contents: [...cards.map((c) => JSON.parse(JSON.stringify(c))), aiCard] };
  const removed = H.filterTree(data, L);
  assert.equal(removed.length, 1);
  assert.equal(data.contents.length, cards.length);
  assert.equal(removed[0].channelId, 'UCsebzRfMhwYfjeBIxNX1brg');
});
