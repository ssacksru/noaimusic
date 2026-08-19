'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const H = require('../src/heuristics.js');

const L = { allowed: {}, blocked: {}, seed: {} };
const ev = (meta, lists) => H.evaluate(meta, lists || L);

test('parseDuration', () => {
  assert.equal(H.parseDuration('3:45'), 225);
  assert.equal(H.parseDuration('1:02:03'), 3723);
  assert.equal(H.parseDuration('LIVE'), 0);
  assert.equal(H.parseDuration(undefined), 0);
});

test('한국어 AI 플레이리스트 차단', () => {
  assert.equal(ev({ title: 'AI 발라드 노래모음 1시간 연속듣기', channel: '뮤직박스' }).action, 'block');
  assert.equal(ev({ title: '[광고없음] 감성 플레이리스트', channel: 'AI뮤직 스테이션' }).action, 'block');
  assert.equal(ev({ title: 'Suno로 만든 감성 발라드 모음', channel: '음악채널' }).action, 'block');
  assert.equal(ev({ title: '인공지능이 작곡한 재즈 모음집', channel: 'relax' }).action, 'block');
  assert.equal(ev({ title: 'AI가 만든 트로트 메들리', channel: '트로트왕' }).action, 'block');
});

test('영어 AI 플레이리스트 차단', () => {
  assert.equal(ev({ title: 'Best AI Generated Music Mix 2026', channel: 'ChillHub' }).action, 'block');
  assert.equal(ev({ title: 'Lofi beats made with AI - 2 hours', channel: 'beats', durationSec: 7200 }).action, 'block');
  assert.equal(ev({ title: 'A.I. Jazz Playlist for Study', channel: 'JazzCat' }).action, 'block');
  assert.equal(ev({ title: 'Relaxing Piano Radio 24/7', channel: 'Udio Sounds' }).action, 'block');
});

test('일반 음악은 통과 (music-clean)', () => {
  assert.equal(ev({ title: '아이유 노래모음 광고없이', channel: '띵곡저장소' }).reason, 'music-clean');
  assert.equal(ev({ title: '잔잔한 카페 음악 3시간', channel: '카페뮤직', durationSec: 10800 }).reason, 'music-clean');
  assert.equal(ev({ title: '2000년대 발라드 플레이리스트', channel: '추억의노래' }).action, 'pass');
});

test('음악 아니면 AI 단어가 있어도 통과', () => {
  assert.equal(ev({ title: 'AI가 바꾸는 미래 - 다큐멘터리', channel: '지식채널', durationSec: 3600 }).reason, 'not-music');
  assert.equal(ev({ title: 'ChatGPT AI 코딩 강의 풀버전', channel: '개발왕', durationSec: 7200 }).reason, 'not-music');
});

test('오탐 가드: AI 철자 함정', () => {
  // 영문자 인접 → 매칭 금지
  assert.equal(ev({ title: 'PAID IN FULL - soul classics mix', channel: 'SoulTrain' }).action, 'pass');
  assert.equal(ev({ title: 'Aida Opera Highlights playlist', channel: 'OperaHouse' }).action, 'pass');
  // 짧은 일반 뮤직비디오는 음악 관문(약한 신호+장시간) 미달 → 통과
  assert.equal(ev({ title: 'Ai Otsuka - Sakuranbo MV', channel: 'avex', durationSec: 240 }).reason, 'not-music');
});

test('목록 우선순위: 허용 > 차단 > 시드 > 휴리스틱', () => {
  const lists = { allowed: { UCA: 1 }, blocked: { UCB: 1 }, seed: { UCS: 1 } };
  assert.equal(ev({ title: 'AI 노래모음', channel: 'x', channelId: 'UCA' }, lists).reason, 'allowlist');
  assert.equal(ev({ title: '아무 영상', channel: 'x', channelId: 'UCB' }, lists).reason, 'blocklist');
  assert.equal(ev({ title: '아무 영상', channel: 'x', channelId: 'UCS' }, lists).reason, 'seed');
});

test('filterTree: 응답 JSON에서 차단 항목 제거·보존', () => {
  const mk = (title, channel, id) => ({
    videoRenderer: {
      videoId: id, title: { runs: [{ text: title }] },
      ownerText: { runs: [{ text: channel, navigationEndpoint: { browseEndpoint: { browseId: 'UC' + id } } }] },
      lengthText: { simpleText: '1:00:00' },
    },
  });
  const data = {
    contents: {
      results: [
        mk('AI 발라드 노래모음', 'AI뮤직', 'aaa'),
        mk('아이유 노래모음', '띵곡저장소', 'bbb'),
        { compactRadioRenderer: { playlistId: 'RD1', title: { simpleText: 'AI generated mix - lofi' } } },
        { other: { nested: [mk('Suno Best Playlist', 'sunofan', 'ccc')] } },
      ],
    },
  };
  const { removed } = H.filterTree(data, L);
  assert.equal(removed.length, 3);
  assert.equal(data.contents.results.length, 2);
  assert.equal(data.contents.results[0].videoRenderer.videoId, 'bbb');
  assert.equal(data.contents.results[1].other.nested.length, 0);
  assert.equal(H.firstVideoId(data), 'bbb');
});

test('filterTree: lockupViewModel (신형 카드)', () => {
  const data = {
    items: [{
      lockupViewModel: {
        contentId: 'PL123', contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST',
        metadata: { lockupMetadataViewModel: { title: { content: 'AI kpop 커버 플레이리스트' } } },
      },
    }],
  };
  const { removed } = H.filterTree(data, L);
  assert.equal(removed.length, 1);
  assert.equal(data.items.length, 0);
});

test('filterTree: 깨진 구조에도 예외 없이 동작', () => {
  const weird = { a: [null, 1, 'str', { videoRenderer: {} }, { lockupViewModel: { metadata: 42 } }], b: null };
  assert.doesNotThrow(() => H.filterTree(weird, L));
});
