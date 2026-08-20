'use strict';
const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const B = require('../src/badges.js');

// 가짜 유튜브 응답으로 채널 단위 확인의 분기들을 검증한다.
// 실측 배경(2026-08-21): 한 AI 채널이 최근 8개 중 4개에만 설명란 공시를 붙였다 —
// 입구 영상 하나만 보고 '아님' 처리하면 절반 확률로 놓친다.
function watchHtml({ disclosure = false, badge = false } = {}) {
  const d = {
    contents: { twoColumnWatchNextResults: { results: { results: { contents: [
      { videoPrimaryInfoRenderer: { badges: badge ? [{ metadataBadgeRenderer:
        { icon: { iconType: 'INFO' }, style: 'BADGE_STYLE_TYPE_SIMPLE' } }] : [] } },
    ] } } } },
    engagementPanels: disclosure ? [{ engagementPanelSectionListRenderer: { content: {
      structuredDescriptionContentRenderer: { items: [{ howThisWasMadeSectionViewModel: {} }] },
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

test('확인 실패는 아님으로 굳지 않는다 — null 로 남겨 다시 시도하게 한다', async () => {
  // 네트워크 실패가 '아님' 캐시가 되는 사고를 두 번 겪었다 (2026-08-20)
  responses = [
    ['watch?v=aaaaaaaaaaa', watchHtml()],
    ['feeds/videos.xml', 'FAIL'],
  ];
  assert.equal(await B.checkChannel(CID, 'aaaaaaaaaaa', false, null), null);
  responses = [
    ['watch?v=aaaaaaaaaaa', watchHtml()],
    ['feeds/videos.xml', rssXml(['bbbbbbbbbbb'])],
    ['watch?v=bbbbbbbbbbb', 'FAIL'],
  ];
  assert.equal(await B.checkChannel(CID, 'aaaaaaaaaaa', false, null), null);
});
