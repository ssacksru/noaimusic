'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const H = require('../src/heuristics.js');

const L = { allowed: {}, blocked: {}, seed: {} };
const ev = (meta, lists) => H.evaluate(meta, lists || L);

test('parseViews — 조회수 표기를 숫자로', () => {
  assert.equal(H.parseViews('조회수 1.2만회'), 12000);
  assert.equal(H.parseViews('조회수 345회'), 345);
  assert.equal(H.parseViews('1.2M views'), 1200000);
  assert.equal(H.parseViews('조회수 5.3천회'), 5300);
  assert.equal(H.parseViews(''), null);
  assert.equal(H.parseViews(undefined), null);
});

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

test('부정 표기가 낱말 속 조각에 걸리지 않는다', () => {
  // "Su(no AI)" 처럼 낱말 안의 "no ai" 가 부정 표기로 오인되면
  // 가장 흔한 AI 음악 생성기(Suno) 를 통째로 놓친다 (2026-08-20 영어 UI 실측).
  assert.equal(ev({ title: 'Suno AI Music Reggae Playlist', channel: '' }).action, 'block');
  assert.equal(ev({ title: 'Piano AI cover playlist', channel: '' }).action, 'block');
  assert.equal(ev({ title: 'Techno AI generated mix', channel: '' }).action, 'block');
});

test('영어 장르어도 음악으로 인식한다', () => {
  // 한국어 어휘만으로는 해외 AI 음악을 음악으로 보지 못해 통째로 새어나갔다 (2026-08-20 실측).
  assert.equal(ev({ title: '27 Minutes of AI Hip‑Hop — 10 Suno Tracks with vocals', channel: '' }).action, 'block');
  assert.equal(ev({ title: 'AI generated ambient tracks', channel: '' }).action, 'block');
  assert.equal(ev({ title: 'Chill reggae vibes made with AI', channel: '' }).action, 'block');
  // 음악어가 있어도 AI 신호가 없으면 그대로 둔다
  assert.equal(ev({ title: 'Best rock band live concert 2026', channel: '' }).reason, 'music-clean');
  // 음악과 무관한 영상은 AI 가 나와도 건드리지 않는다
  assert.equal(ev({ title: 'NBA highlights - AI referee controversy', channel: '' }).reason, 'not-music');
});

test('부정 표기에 명사가 끼어도 통과시킨다 (실사용 오탐)', () => {
  // 2026-08-20 실사용 제보: 사람이 연주한 채널의 "AI 음악 아님" 표기를 차단했다
  const t = '잘때 듣기 좋은 음악.. 10분 안에 잠이 솔솔 옵니다 | 🙅🏻 AI 음악 아님 | Sleep Jazz | Relaxing Background Music';
  assert.equal(ev({ title: t, channel: 'WRG 우리가 듣고 싶어서 연주한 playlist', durationSec: 3600 }).reason, 'ai-negated');
  assert.equal(ev({ title: 'AI 노래 아님! 직접 부른 커버', durationSec: 240 }).reason, 'ai-negated');
  // 부정 확장이 진짜 AI 를 놓치게 만들면 안 된다
  assert.equal(ev({ title: 'AI 음악 모음 1시간', durationSec: 3600 }).action, 'block');
});

test('진짜 부정 표기는 그대로 통과시킨다', () => {
  for (const t of ['(NO AI) BGM 모음 플레이리스트', 'NON-AI acoustic playlist',
                   'AI-free jazz collection', 'Without AI - real musicians only playlist']) {
    assert.equal(ev({ title: t, channel: '' }).reason, 'ai-negated', t);
  }
});

test('다국어 AI 표기를 잡는다 (IA·KI·нейросеть·AI生成)', () => {
  // 스페인어권은 AI 를 IA 라고 쓴다. 이걸 몰라서 스페인어 검색 결과가
  // 통째로 새어나갔다 (2026-08-20 실측: 13개 중 12개 미탐).
  const b = (t, d = 0, p = true) => ev({ title: t, channel: '', durationSec: d, isPlaylist: p }).action;
  assert.equal(b('🎧 Música Electrónica Creada por Inteligencia Artificial'), 'block');
  assert.equal(b('Música generada por IA'), 'block');
  assert.equal(b('Cumbia IA (Neo Música 2026) videos musicales IA en Español'), 'block');
  assert.equal(b('La Nave del Olvido - José José (Versión JAZZ IA)', 350, false), 'block');
  assert.equal(b('KI-generierte Musik Playlist'), 'block');
  assert.equal(b('Музыка созданная нейросетью плейлист', 3600, false), 'block');
  assert.equal(b('[BGM / Inst] 水天一碧 | relax #ai #aiart', 3627, false), 'block');
});

test('다국어 확장이 일반 음악·영상을 오탐하지 않는다', () => {
  const p = (t, d = 3600) => ev({ title: t, channel: '', durationSec: d, isPlaylist: false }).action;
  assert.equal(p('Sofia Carson - Live in Madrid concierto'), 'pass');   // IA 가 낱말 속에 있음
  assert.equal(p('Mia Martina - Latin Moon official video', 240), 'pass');
  assert.equal(p('MEDIA PLAYER review 2026', 600), 'pass');
  assert.equal(p('Música clásica de Mozart sinfonía completa'), 'pass');
});

test('커버곡은 길이와 무관하게 음악으로 본다', () => {
  // AI 딥페이크 커버는 3분짜리로 올라온다 — 장시간 관문을 요구하면 전부 놓친다.
  assert.equal(ev({ title: 'Maracas - Cover AMLO x Donald Trump IA', durationSec: 80 }).action, 'block');
  assert.equal(ev({ title: '적우 - 하루만 AI 커버', durationSec: 280 }).action, 'block');
  // 사람이 부른 커버는 그대로 둔다
  assert.equal(ev({ title: 'Adele - Hello (piano cover)', durationSec: 240 }).reason, 'music-clean');
});

test('독일어·프랑스어·러시아어 AI 음악을 잡는다', () => {
  const b = (t, c = '', d = 0, p = true) => ev({ title: t, channel: c, durationSec: d, isPlaylist: p }).action;
  assert.equal(b("Chanson d'amour – Créée entièrement par IA", '', 198, false), 'block');
  assert.equal(b('AI Rock Song | KI Rockmusik', '', 305, false), 'block');
  assert.equal(b('НЕЙРО КАВЕРЫ, Ai, Искусственный интеллект'), 'block');
  assert.equal(b('Песни в исполнении искусственного интеллекта'), 'block');
});

test('다국어 튜토리얼은 통과시킨다', () => {
  const r = (t, d = 600) => ev({ title: t, channel: '', durationSec: d, isPlaylist: false }).reason;
  assert.equal(r("Comment créer une chanson avec une IA", 129), 'about-ai');
  assert.equal(r('Mit KI Musik machen: So erstellst du einen Hit in 10 Minuten', 682), 'about-ai');
  assert.equal(r('How To Make Song Covers with Suno AI (Step-by-Step Guide)', 70), 'about-ai');
});

test('노래 제목 속 "how to" 를 튜토리얼로 오인하지 않는다', () => {
  // 실측: AI 음악인데 노래 제목에 "Don't Tell Me How to Live" 가 들어 통과했다 (2026-08-20)
  const v = ev({ title: 'AI Rock Song – "My Life (Don\'t Tell Me How to Live)"', channel: '', durationSec: 305 });
  assert.equal(v.action, 'block', `튜토리얼로 오인: ${v.reason}`);
});

test('사람이 부른 커버·연주는 다국어에서도 통과', () => {
  const r = (t, d = 240) => ev({ title: t, channel: '', durationSec: d, isPlaylist: false }).action;
  assert.equal(r('Кавер на песню Кино - Группа крови (живой звук)'), 'pass');
  assert.equal(r('Sokolov plays Chopin - classical piano recital', 3600), 'pass');
  assert.equal(r('Kim Wilde - Kids in America official video'), 'pass');
});

test('복수형·활용형 음악어를 놓치지 않는다', () => {
  // "\\bmusique\\b" 는 복수형 "musiques" 를 못 잡고, "musiken?" 은 "Musik" 을 못 잡았다 (2026-08-20 실측)
  assert.equal(ev({ title: '5 musiques créées par IA', durationSec: 383 }).action, 'block');
  assert.equal(ev({ title: 'Musik KI generiert entspannend', durationSec: 3600 }).action, 'block');
  assert.equal(ev({ title: "Chanson d’amour IA (Pop romantique)", durationSec: 196 }).action, 'block');
});

test('곡을 뜻하는 말이 있으면 짧아도 음악으로 본다', () => {
  // AI 노래는 3분짜리 단일곡으로 올라온다 — 장시간 관문만 두면 전부 새어나간다
  assert.equal(ev({ title: 'Édith Piaf - La Vie en rose chanson classique', durationSec: 180 }).reason, 'music-clean');
  assert.equal(ev({ title: 'Mia - chanson française live', durationSec: 240 }).action, 'pass');
});

test('도구명이 낱말 속에 있으면 걸리지 않는다', () => {
  // "Studio" 안에 "udio" 가 들어 있다 — 경계가 없으면 스튜디오 이름이 전부 AI 로 잡힌다
  for (const t of ['Lofi beats from Soul R&B Studio - 3 hours',
                   'MyShare music studio playlist',
                   'Studio Ghibli piano collection']) {
    assert.equal(ev({ title: t, durationSec: 3600 }).action, 'pass', t);
  }
});

test('차단한 채널의 유튜브 자동생성 믹스도 걸러낸다', () => {
  // 믹스는 채널 ID 가 없어 채널 차단으로 안 잡힌다. 그대로 두면 눌렀을 때
  // 그 채널 음악이 연속 재생된다 (2026-08-20 실측: balcony9 를 차단해도 믹스가 남았다).
  const L = { allowed: {}, blocked: {}, seed: {}, blockedNames: ['balcony9', 'cherry music'] };
  const mix = (t, v = 'RDabc') => H.evaluate({ title: t, videoId: v, channelId: '', isPlaylist: true }, L);
  assert.equal(mix('믹스 - [playlist] balcony9 | 숲을 바라보는 통창 공간').action, 'block');
  assert.equal(mix('믹스 - cherry music 카페 음악').action, 'block');
  // 관계없는 믹스는 그대로
  assert.equal(mix('믹스 - 아이유 노래모음').action, 'pass');
  // 믹스가 아니면 제목에 이름이 있어도 건드리지 않는다
  assert.equal(H.evaluate({ title: 'balcony9 채널 리뷰', videoId: 'abc12345678',
    channelId: 'UCother', isPlaylist: false, durationSec: 600 }, L).action, 'pass');
});

test('흔한 일반어 채널명은 믹스 제목 매칭에 쓰지 않는다', () => {
  // "음악"·"playlist" 같은 이름으로 매칭하면 정상 믹스가 대량 오탐된다
  const L = { allowed: {}, blocked: {}, seed: {}, blockedNames: ['음악', 'playlist', 'mix', 'abc'] };
  const mix = (t) => H.evaluate({ title: t, videoId: 'RDx', channelId: '', isPlaylist: true }, L);
  assert.equal(mix('믹스 - 잔잔한 음악 모음').action, 'pass');
  assert.equal(mix('믹스 - chill playlist for study').action, 'pass');
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

test('설명란 "콘텐츠 생성 방식" 공시를 감지한다', () => {
  // 제목 옆 배지 없이 설명란 공시만 있는 AI 영상이 실존한다 (2026-08-21 실사용 제보:
  // "Piano music for relaxing" — 콘텐츠 생성 방식 → AI로 제작)
  const withDisclosure = {
    engagementPanels: [
      { engagementPanelSectionListRenderer: { content: {} } },
      { engagementPanelSectionListRenderer: { content: { structuredDescriptionContentRenderer: {
        items: [{ videoDescriptionHeaderRenderer: {} },
                { howThisWasMadeSectionViewModel: { sectionTitle: { content: '콘텐츠 생성 방식' } } }],
      } } } },
    ],
  };
  assert.equal(H.hasAiDisclosure(withDisclosure), true);
  // 정상 영상엔 섹션 자체가 없다 (실측: 인기 MV·저조회 일반 음악 모두 없음)
  const without = { engagementPanels: [{ engagementPanelSectionListRenderer: { content: {
    structuredDescriptionContentRenderer: { items: [{ videoDescriptionHeaderRenderer: {} }] },
  } } }] };
  assert.equal(H.hasAiDisclosure(without), false);
  assert.equal(H.hasAiDisclosure({}), false);
  assert.equal(H.hasAiDisclosure(null) || false, false);
});
