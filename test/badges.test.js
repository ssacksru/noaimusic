'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const B = require('../src/badges.js');

// 가짜 유튜브 응답으로 채널 단위 확인의 분기들을 검증한다.
// 실측 배경(2026-08-21): 한 AI 채널이 최근 8개 중 4개에만 설명란 공시를 붙였다 —
// 입구 영상 하나만 보고 '아님' 처리하면 절반 확률로 놓친다.
// 설명란 섹션은 도움말 문서 번호로 종류가 갈린다: 15447836 = AI 공시, 15569972 = 자동 더빙
const howSection = (doc) => ({ howThisWasMadeSectionViewModel: { bodyText: { commandRuns: [{ onTap: {
  innertubeCommand: { urlEndpoint: { url: `//support.google.com/youtube/answer/${doc}?hl=ko` } } } }] } } });
function watchHtml({ disclosure = false, badge = false, dubbed = false } = {}) {
  const d = {
    contents: { twoColumnWatchNextResults: { results: { results: { contents: [
      { videoPrimaryInfoRenderer: { badges: badge ? [{ metadataBadgeRenderer:
        { icon: { iconType: 'INFO' }, style: 'BADGE_STYLE_TYPE_SIMPLE' } }] : [] } },
    ] } } } },
    engagementPanels: (disclosure || dubbed) ? [{ engagementPanelSectionListRenderer: { content: {
      structuredDescriptionContentRenderer: { items: [howSection(disclosure ? '15447836' : '15569972')] },
    } } }] : [],
  };
  return 'var ytInitialData = ' + JSON.stringify(d) + ';</script>';
}
function rssXml(ids) {
  return ids.map((v) => `<entry><yt:videoId>${v}</yt:videoId></entry>`).join('');
}
const CID = 'UC' + 'x'.repeat(22);
let responses;
beforeEach(() => {
  global.fetch = async (url) => {
    for (const [pat, body] of responses) {
      if (url.includes(pat)) {
        if (body === 'FAIL') return { ok: false };
        return { ok: true, text: async () => body };
      }
    }
    throw new Error('unexpected ' + url);
  };
});

test('입구 영상에 공시가 있으면 그걸로 끝 — 추가 확인 없음', async () => {
  responses = [['watch?v=aaaaaaaaaaa', watchHtml({ disclosure: true })]];
  assert.deepEqual(await B.checkChannel(CID, 'aaaaaaaaaaa', false, null),
    { verdict: 'ai', reason: 'label' });
});

test('입구는 깨끗해도 채널의 다른 영상에서 공시를 찾아낸다', async () => {
  responses = [
    ['watch?v=aaaaaaaaaaa', watchHtml()],
    ['feeds/videos.xml', rssXml(['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd'])],
    ['watch?v=bbbbbbbbbbb', watchHtml()],
    ['watch?v=ccccccccccc', watchHtml({ disclosure: true })],
    ['watch?v=ddddddddddd', watchHtml()],
  ];
  assert.deepEqual(await B.checkChannel(CID, 'aaaaaaaaaaa', false, null),
    { verdict: 'ai', reason: 'label' });
});

test('전부 깨끗하면 그때야 아님으로 판정한다', async () => {
  responses = [
    ['watch?v=aaaaaaaaaaa', watchHtml()],
    ['feeds/videos.xml', rssXml(['bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd'])],
    ['watch?v=', watchHtml()],
  ];
  const r = await B.checkChannel(CID, 'aaaaaaaaaaa', false, null);
  assert.equal(r.verdict, 'ok');
});

test('영상 확인 실패는 아님으로 굳지 않는다 — null 로 남겨 다시 시도하게 한다', async () => {
  // 네트워크 실패가 '아님' 캐시가 되는 사고를 두 번 겪었다 (2026-08-20).
  // 핵심 보장: **시청 페이지를 못 읽었으면** 어떤 판정도 내리지 않는다.
  // (채널 목록을 못 얻은 경우는 다르다 — 실제로 확인한 영상의 판정이 있으므로
  //  그걸 쓴다. 아래 '무한 재시도 방지' 테스트 참고. 2026-08-25 정책)
  responses = [
    ['watch?v=aaaaaaaaaaa', watchHtml()],
    ['feeds/videos.xml', rssXml(['bbbbbbbbbbb'])],
    ['watch?v=bbbbbbbbbbb', 'FAIL'],
  ];
  assert.equal(await B.checkChannel(CID, 'aaaaaaaaaaa', false, null), null);
});

test('RSS 가 막히면 채널 영상 페이지로 우회한다', async () => {
  // 유튜브가 feeds/videos.xml 을 404 로 막는 것을 실측했다(2026-08-25).
  // 한 경로에만 기대면 채널 단위 확인이 통째로 죽는다.
  responses = [
    ['feeds/videos.xml', 'FAIL'],
    ['/videos', '"videoId":"bbbbbbbbbbb" ... "videoId":"ccccccccccc"'],
  ];
  const ids = await B.channelVideoIds(CID);
  assert.deepEqual(ids, ['bbbbbbbbbbb', 'ccccccccccc']);
});

test('목록을 아예 못 얻으면 입구 영상 판정을 쓴다 (무한 재시도 방지)', async () => {
  // null 을 돌려주면 캐시되지 않아 같은 채널을 영원히 다시 확인하고,
  // 그 요청이 다시 차단을 부르는 되먹임이 생긴다.
  responses = [
    ['watch?v=aaaaaaaaaaa', watchHtml()],
    ['feeds/videos.xml', 'FAIL'],
    ['/videos', 'FAIL'],
  ];
  const r = await B.checkChannel(CID, 'aaaaaaaaaaa', false, null);
  assert.equal(r.verdict, 'ok', '입구 판정으로 떨어져야 한다');
});

test('자동 더빙 안내만 있는 채널은 AI 가 아니다', async () => {
  // 실사용 사고(2026-09-23): 자동 더빙 안내가 같은 섹션에 실려 일반 채널이 AI 로 학습됐다
  responses = [
    ['watch?v=aaaaaaaaaaa', watchHtml({ dubbed: true })],
    ['feeds/videos.xml', rssXml(['bbbbbbbbbbb', 'ccccccccccc', 'ddddddddddd'])],
    ['watch?v=', watchHtml({ dubbed: true })],
  ];
  assert.deepEqual(await B.checkChannel(CID, 'aaaaaaaaaaa', false, null),
    { verdict: 'ok', reason: 'label' });
});
