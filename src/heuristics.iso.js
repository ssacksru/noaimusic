// NoAI Music — 판별 코어. 순수 로직만: DOM/chrome API 접근 금지 (MAIN world + content + node 테스트 공유)
(function (root) {
  'use strict';

  // ── 1단계: 음악 관문 ─────────────────────────────────────────
  // 강한 음악 신호: 이것만으로 음악 콘텐츠로 본다
  const MUSIC_STRONG = new RegExp(
    [
      '(?<!자)모음', '연속\\s*듣기', '연속\\s*재생', '믹스',
      '플레이\\s*리스트', '플리\\b', 'playlist', '재생목록', '광고\\s*없', '메들리', '논스톱',
      '\\bmix(es|tape)?\\b', '\\bmegamix\\b', '\\bmedley\\b', '\\bcompilation\\b',
      '\\bfull\\s+album\\b', '\\bnonstop\\b', '\\bgreatest\\s+hits\\b', '\\b24/7\\b',
      '\\bbgm\\b', '노동요', '출근길', '드라이브\\s*(곡|노래|음악)',
      // 커버곡은 길이와 무관하게 음악 콘텐츠다 — AI 딥페이크 커버가 3분짜리로 올라온다
      '\\bcovers?\\b', '커버',
      // "곡" 자체를 가리키는 말도 마찬가지 (3분짜리 단일곡)
      '\\bchansons?\\b', 'canci[oó]n(es)?', '\\blieder?\\b',
    ].join('|'),
    'i'
  );

  // 약한 음악 신호: 장시간 영상 또는 재생목록 카드와 결합해야 음악으로 본다
  const MUSIC_WEAK = new RegExp(
    [
      '\\bmusic\\b', '\\bsongs?\\b', '노래', '음악', '가요', '동요', '발라드', '트로트',
      '\\bk-?pop\\b', '\\bj-?pop\\b', '\\bpop\\b', '\\bballads?\\b', '\\bjazz\\b', '재즈',
      '\\blo-?fi\\b', '\\bpiano\\b', '피아노', '\\bost\\b', '\\bcovers?\\b', '커버',
      '\\bremix\\b', '\\binstrumental\\b', '연주곡', '\\bchill\\b', '\\brelax(ing)?\\b',
      '힐링', '수면', '태교', '카페', '\\bcafe\\b', '\\bccm\\b', '찬양', '캐롤', '\\bcarols?\\b',
      '\\bedm\\b', '\\bbeats?\\b', '\\bhits\\b', '\\bradio\\b',
      // 영어 장르·형식어 — 한국어 목록만으로는 해외 AI 음악을 음악으로 인식하지 못했다
      // (실측 2026-08-20: "27 Minutes of AI Hip-Hop — 10 Suno Tracks" 가 통과했다)
      'hip[\\s\\-\\u2010-\\u2015]?hop', '\\brap\\b', '\\brock\\b', '\\bsoul\\b', '\\bfunk\\b',
      '\\bdisco\\b', '\\bhouse\\s+music\\b', '\\btechno\\b', '\\btrance\\b', '\\btrap\\b',
      '\\bambient\\b', '\\bacoustic\\b', '\\borchestral?\\b', '\\bsymphony\\b', '\\bopera\\b',
      '\\btracks?\\b', '\\btunes?\\b', '\\bmelod(y|ies)\\b', '\\bvocals?\\b', '\\bsinger\\b',
      '\\bband\\b', '\\balbum\\b', '\\bsoundtrack\\b', '\\bmashup\\b', '\\bkaraoke\\b',
      '\\bgroove\\b', '\\bvibes?\\b', '\\bbossa\\b', '\\bblues\\b', '\\bcountry\\s+music\\b',
      '\\breggae\\b', '\\bsynthwave\\b', '\\bcity\\s*pop\\b',
      // 다국어 음악어 — 이게 없어 스페인어·러시아어·일본어 AI 음악이 음악으로 인식조차 안 됐다
      // (실측 2026-08-20: "Música generada por IA" 가 not-music 으로 통과했다)
      'm[uú]sic[ao]s?', '\\bmusik(en)?\\b', '\\bmusiques?\\b', 'canci[oó]n(es)?',
      'музык', 'песн', 'кавер', 'трек', '音楽', '音乐', '\\bkanpai\\b', '\\bcumbia\\b', '\\bsalsa\\b',
      '\\bbachata\\b', '\\breggaeton\\b', '\\bbalada\\b', '\\bflamenco\\b', '\\brumba\\b',
      '\\bsertanejo\\b', '\\bmpb\\b', '\\bsamba\\b', '\\bfado\\b', '\\blied(er)?\\b',
      '\\bchanson\\b', '\\bplaylist\\b', '作業用', 'ボカロ', '\\binst\\b',
    ].join('|'),
    'i'
  );

  const LONG_VIDEO_SEC = 20 * 60;

  // ── 2단계: AI 신호 ──────────────────────────────────────────
  // 강한 신호: 도구명·명시 문구 (대소문자 무시)
  const AI_STRONG = new RegExp(
    [
      '\\bsuno\\b', '\\budio\\b', '\\bmubert\\b', '\\briffusion\\b',
      'a\\.?i\\.?[\\s\\-]*(generated|generation|music|songs?|covers?|singers?|artists?|bands?|voice|vocals?|remix|playlist|mix|radio)',
      '(generated|made|created|composed|written|produced)\\s+(by|with|using)\\s+a\\.?i\\.?',
      'ai(가|로|이)?\\s*(만든|만들어|생성|작곡|작사|제작)',
      'ai\\s*(커버|노래|음악|플레이리스트|플리|가수|목소리|보컬|송)',
      '인공\\s*지능\\s*(음악|노래|작곡|커버|가수|보컬)?',
      '생성형\\s*(ai|음악)',
      // 스페인어·포르투갈어: AI 를 IA 라고 쓴다 (실측 2026-08-20 — 스페인어 검색 결과가 통째로 새어나갔다)
      'intelig[eê]ncia\\s+artificial',
      '(generad|cread|hech|compuest|cantad)[oa]s?\\s+(por|con|usando)\\s+i\\.?a\\.?',
      '\\b(con|por|de)\\s+i\\.?a\\.?(?![A-Za-z])',
      '\\bi\\.?a\\.?[\\s\\-]*(cover|music|m[uú]sica|canci[oó]n|versi[oó]n|generad|beats)',
      // 프랑스어
      'intelligence\\s+artificielle', 'g[eé]n[eé]r[eé]e?\\s+par\\s+i\\.?a\\.?',
      // 독일어
      'k[uü]nstliche[rn]?\\s+intelligenz', '\\bki[\\s\\-]*(generiert|musik|song)',
      // 러시아어
      'нейросет', '\\bии[\\s\\-]*(музык|генер|песн)',
      // 일본어
      'ai\\s*(生成|作曲|作成|カバー|音楽|ソング)', '生成\\s*ai', 'aiで(作|生成)',
      // 장르어 바로 뒤의 IA — 스페인어권에서 흔한 표기 ("Cumbia IA", "Versión JAZZ IA")
      '(versi[oó]n|cover|remix|mix|cumbia|salsa|bachata|reggaeton|balada|flamenco|rumba|jazz|rock|pop|trap|house|techno|blues|chanson|musique|m[uú]sica|musik|lied|song|canci[oó]n)s?\\s*[\\-–|·\\u2019\\u0027]?\\s*i\\.?a\\.?(?![A-Za-z])',
      // 해시태그로 AI 를 밝히는 관행 (#ai #aimusic #aiart #sunoai)
      '#\\s?ai(music|art|song|cover|generated)?(?![A-Za-z])',
      // 프랑스어: 부사가 끼어든다 ("Créée entièrement par IA")
      'cr[eé]{2}e?s?\\s+(\\S+\\s+)?(par|avec)\\s+(une\\s+)?i\\.?a\\.?(?![A-Za-z])',
      // 러시아어
      'искусственн\\S*\\s+интеллект', 'нейро[\\s\\-]?(кавер|песн|музык)',
      // AI 토큰 바로 뒤에 장르가 오는 흔한 표기 ("AI Rock Song", "KI Rockmusik", "IA Cumbia")
      '(^|[^A-Za-z])(ai|ki|ia)[\\s\\-]+(rock|pop|jazz|edm|rap|hip[\\s\\-]?hop|country|folk|metal|blues|soul|dance|disco|techno|house|trance|ambient|classical|klassik|lo-?fi|musik|music|musique|m[uú]sica|song|lied|chanson)',
    ].join('|'),
    'i'
  );

  // 맨몸 AI 토큰 — 대문자만, 영문자 인접 금지 ("PAID", "Aida", "MEDIA" 등 오탐 방지).
  // 언어별 표기를 함께 본다: AI(영·한·일) · IA(스페인·포르투갈·프랑스) · KI(독일) · ИИ(러시아).
  const AI_BARE = /(^|[^A-Za-z])(?:A\.?I\.?|IA|KI)(?![A-Za-z])|(^|[^А-Яа-я])ИИ(?![А-Яа-я])/;

  // AI를 부정하는 표기 — "(NO AI)" 처럼 AI가 아님을 강조한 영상을 차단하면 정반대다.
  // 단어 시작 경계가 없으면 "Su(no AI)" 처럼 낱말 속 조각이 걸린다.
  // Suno 는 가장 흔한 AI 음악 생성기라, 그 오탐 하나로 대량의 AI 음악을 놓쳤다(실측 2026-08-20).
  const AI_NEGATED = new RegExp(
    [
      '\\bno[\\s\\-]*a\\.?i\\.?\\b', '\\bnon[\\s\\-]*a\\.?i\\.?\\b', '\\ba\\.?i\\.?[\\s\\-]*free\\b',
      '\\bwithout\\s+a\\.?i\\.?',
      // "AI 아님"뿐 아니라 "AI 음악 아님"처럼 명사가 끼는 형태도 부정이다
      // (2026-08-20 실사용 오탐: "🙅🏻 AI 음악 아님 | Sleep Jazz" 를 차단했다)
      'ai\\s*(음악|노래|생성|사용|목소리|보컬)?\\s*(아님|아니에요|아닙니다|없음|없이|미사용|안\\s*씀|배제)',
      'not\\s+(made\\s+)?(by|with)\\s+a\\.?i\\.?', '\\bai\\s*x\\b',
      '사람이\\s*(만든|부른|작곡|연주)', '직접\\s*(연주|작곡|부른|제작)', '실제\\s*(가수|사람|연주)',
    ].join('|'),
    'i'
  );

  // AI 음악을 "듣는" 게 아니라 "설명하는" 영상 — 강의·튜토리얼·정보 콘텐츠.
  // 실측(2026-08-19) 검색 결과에서 이 유형이 20건 중 4건 나왔다.
  const ABOUT_AI = new RegExp(
    [
      '알려드립니다', '알려드릴', '정리해', '설명해', '강의', '튜토리얼', '만드는\\s*법', '만들기',
      '사용법', '방법', '따라하', '수익', '돈\\s*(버는|벌기|되는|안되는)', '후기', '비교',
      '이유\\s*\\d*가지', '총정리', '가이드', '\\btutorial\\b', '\\bexplained\\b',
      '\\breview\\b', '\\bvs\\.?\\b', '노하우', '꿀팁', '초보',
      // "how to" 는 제목 맨 앞이나 구분자 뒤일 때만 튜토리얼로 본다.
      // 노래 제목 안에 들어간 경우("Don't Tell Me How to Live")까지 통과시키면 안 된다.
      '(^|[|\\-–—:(\\[]\\s*)how\\s+to\\b',
      // 다국어 튜토리얼 표현
      'comment\\s+(cr[eé]er|faire)', 'c[oó]mo\\s+(crear|hacer)', 'wie\\s+man\\b',
      '\\berstell\\w*\\b', '\\bmachen\\b', '\\banleitung\\b', 'как\\s+(сделать|создать)',
      '\\bstep[\\s\\-]by[\\s\\-]step\\b', '\\bguide\\b', '\\bcurso\\b', '\\btutoriel\\b',
    ].join('|'),
    'i'
  );

  // "조회수 1.2만회" / "1.2M views" → 숫자. 검사 우선순위를 정하는 데 쓴다.
  function parseViews(text) {
    if (!text || typeof text !== 'string') return null;
    const m = text.replace(/,/g, '').match(/([\d.]+)\s*([만천억KMB])?/i);
    if (!m) return null;
    const n = parseFloat(m[1]);
    if (!isFinite(n)) return null;
    const unit = (m[2] || '').toUpperCase();
    const mul = { '만': 1e4, '천': 1e3, '억': 1e8, K: 1e3, M: 1e6, B: 1e9 }[unit] || 1;
    return Math.round(n * mul);
  }

  function parseDuration(text) {
    if (!text || typeof text !== 'string') return 0;
    const m = text.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
    if (!m) return 0;
    return (Number(m[1]) || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }

  // 믹스·재생목록 카드인가. 누르면 그 채널 음악이 연속 재생되므로 함께 본다.
  // (RD=믹스/라디오, PL=재생목록, OLAK=앨범. 일반 영상 카드는 대상이 아니다.)
  function isMixCard(meta) {
    return /^(RD|PL|OLAK)/.test(meta.videoId || '') || !!meta.isPlaylist;
  }

  // 채널명이 흔한 일반어면 제목 매칭이 위험하다 — 그런 이름은 쓰지 않는다
  const GENERIC_NAME = /^(music|musica|musik|playlist|mix|bgm|lofi|jazz|piano|pop|radio|studio|sound|음악|노래|재생목록|플레이리스트|믹스|힐링|카페)$/i;

  function blockedNameIn(names, title) {
    if (!names || !names.length || !title) return '';
    const t = title.toLowerCase();
    for (const n of names) {
      const name = String(n || '').trim();
      if (name.length < 4 || GENERIC_NAME.test(name)) continue;
      if (t.indexOf(name.toLowerCase()) !== -1) return name;
    }
    return '';
  }

  function has(map, key) {
    if (!map || !key) return false;
    return map instanceof Set ? map.has(key) : Object.prototype.hasOwnProperty.call(map, key);
  }

  // meta: {title, channel, channelId, durationSec, isPlaylist}
  // lists: {allowed, blocked, seed} — 채널 ID → truthy (plain object 또는 Set)
  function evaluate(meta, lists) {
    lists = lists || {};
    const title = meta.title || '';
    const channel = meta.channel || '';
    const text = title + ' \u0000 ' + channel;

    if (has(lists.allowed, meta.channelId)) return { action: 'pass', reason: 'allowlist' };
    if (has(lists.blocked, meta.channelId)) return { action: 'block', reason: 'blocklist' };
    if (has(lists.seed, meta.channelId)) return { action: 'block', reason: 'seed' };

    // 유튜브 자동생성 "믹스"는 채널 ID 가 없어 채널 차단으로 잡히지 않는다.
    // 대신 제목에 원본 채널명이 실려 온다("믹스 - [playlist] balcony9 | ...").
    // 차단한 채널의 믹스를 그대로 두면 눌렀을 때 그 채널 음악이 연속 재생된다(실측 2026-08-20).
    if (isMixCard(meta)) {
      const hit = blockedNameIn(lists.blockedNames, title);
      if (hit) return { action: 'block', reason: 'mix:' + hit };
    }

    // 음악 관문 2단.
    // musicish = 음악 얘기가 나오는가 (AI 증거가 확실할 때 이것만으로 충분 — AI 커버 단일곡은 3분짜리다)
    // musicContent = 듣기용 음악 콘텐츠인가 (맨몸 "AI" 토큰처럼 약한 증거엔 이 수준을 요구)
    const musicish = MUSIC_STRONG.test(text) || MUSIC_WEAK.test(text);
    if (!musicish) return { action: 'pass', reason: 'not-music' };
    const musicContent =
      MUSIC_STRONG.test(text) || meta.isPlaylist || (meta.durationSec || 0) >= LONG_VIDEO_SEC;

    // AI가 아님을 명시했거나, AI 음악을 설명하는 영상이면 차단하지 않는다
    if (AI_NEGATED.test(text)) return { action: 'pass', reason: 'ai-negated' };
    if (ABOUT_AI.test(title)) return { action: 'pass', reason: 'about-ai' };

    const strong = text.match(AI_STRONG);
    if (strong) return { action: 'block', reason: 'keyword:' + strong[0].trim() };
    if (musicContent) {
      const bare = text.match(AI_BARE);
      if (bare) return { action: 'block', reason: 'keyword:AI' };
    }

    // 음악인데 AI 신호 없음 — 채널 프로파일링 후보
    return { action: 'pass', reason: 'music-clean' };
  }

  // ── YouTube 내부 응답 JSON에서 비디오/재생목록 메타 추출 ─────────
  const VIDEO_KEYS = ['videoRenderer', 'compactVideoRenderer', 'gridVideoRenderer', 'videoWithContextRenderer'];
  const PLAYLIST_KEYS = ['playlistRenderer', 'gridPlaylistRenderer', 'compactPlaylistRenderer', 'radioRenderer', 'compactRadioRenderer'];

  function textOf(t) {
    if (!t) return '';
    if (typeof t === 'string') return t;
    if (t.simpleText) return t.simpleText;
    if (Array.isArray(t.runs)) return t.runs.map((r) => r.text || '').join('');
    if (t.content) return t.content;
    return '';
  }

  function metaFromClassic(r, isPlaylist) {
    const byline = r.ownerText || r.longBylineText || r.shortBylineText;
    const run0 = byline && Array.isArray(byline.runs) ? byline.runs[0] : null;
    let durationSec = parseDuration(textOf(r.lengthText));
    if (!durationSec && Array.isArray(r.thumbnailOverlays)) {
      for (const o of r.thumbnailOverlays) {
        const t = o && o.thumbnailOverlayTimeStatusRenderer;
        if (t) { durationSec = parseDuration(textOf(t.text)); break; }
      }
    }
    return {
      videoId: r.videoId || r.playlistId || '',
      views: parseViews(textOf(r.viewCountText) || textOf(r.shortViewCountText)),
      title: textOf(r.title) || textOf(r.headline),
      channel: run0 ? run0.text || '' : '',
      channelId:
        (run0 && run0.navigationEndpoint && run0.navigationEndpoint.browseEndpoint &&
          run0.navigationEndpoint.browseEndpoint.browseId) || '',
      durationSec,
      isPlaylist: !!isPlaylist,
    };
  }

  function metaFromLockup(l) {
    const md = l.metadata && l.metadata.lockupMetadataViewModel;
    const meta = {
      videoId: l.contentId || '',
      title: md ? textOf(md.title) : '',
      channel: '',
      channelId: '',
      durationSec: 0,
      isPlaylist: /PLAYLIST|MIX|ALBUM|PODCAST/i.test(l.contentType || ''),
    };
    try {
      const rows =
        md.metadata.contentMetadataViewModel.metadataRows || [];
      for (const row of rows) {
        for (const part of row.metadataParts || []) {
          const t = part.text || {};
          const br =
            t.commandRuns && t.commandRuns[0] && t.commandRuns[0].onTap &&
            t.commandRuns[0].onTap.innertubeCommand &&
            t.commandRuns[0].onTap.innertubeCommand.browseEndpoint;
          if (br && typeof br.browseId === 'string' && br.browseId.indexOf('UC') === 0) {
            meta.channel = textOf(t);
            meta.channelId = br.browseId;
          }
        }
      }
      if (!meta.channel && rows[0] && rows[0].metadataParts && rows[0].metadataParts[0]) {
        meta.channel = textOf(rows[0].metadataParts[0].text);
      }
      for (const row of rows) {
        for (const part of row.metadataParts || []) {
          const t = textOf(part.text);
          if (/조회수|views|回視聴|vistas/i.test(t)) { meta.views = parseViews(t); }
        }
      }
    } catch (e) { /* 메타데이터 구조가 다르면 제목만으로 판별 */ }
    try {
      // 실측(2026-08): 길이 배지는 thumbnailBottomOverlayViewModel.badges[].thumbnailBadgeViewModel.text.
      // 구형 thumbnailOverlayBadgeViewModel.thumbnailBadges 도 함께 지원한다.
      for (const o of l.contentImage.thumbnailViewModel.overlays || []) {
        const holder = o.thumbnailBottomOverlayViewModel || o.thumbnailOverlayBadgeViewModel;
        if (!holder) continue;
        for (const b of holder.badges || holder.thumbnailBadges || []) {
          const t = b.thumbnailBadgeViewModel && b.thumbnailBadgeViewModel.text;
          if (t && /^\d+(:\d{2})+$/.test(t.trim())) meta.durationSec = parseDuration(t.trim());
        }
      }
    } catch (e) { /* 길이 없으면 0 */ }
    return meta;
  }

  // 배열 항목 하나에서 비디오 메타 추출. 비디오형이 아니면 null.
  function metaFromItem(obj) {
    if (!obj || typeof obj !== 'object') return null;
    if (obj.richItemRenderer) return metaFromItem(obj.richItemRenderer.content);
    for (const k of VIDEO_KEYS) if (obj[k]) return metaFromClassic(obj[k], false);
    for (const k of PLAYLIST_KEYS) if (obj[k]) return metaFromClassic(obj[k], true);
    if (obj.lockupViewModel) return metaFromLockup(obj.lockupViewModel);
    return null;
  }

  // 트리 전체를 순회하며 차단 판정 항목을 배열에서 제거한다.
  // { removed, candidates } 반환 — candidates 는 음악이지만 AI 신호가 없어
  // 채널 프로파일링이 필요한 항목(채널 ID 보유)이다.
  // 어떤 예외도 밖으로 던지지 않는다 — 실패 시 그 서브트리는 그대로 둔다.
  function filterTree(rootNode, lists) {
    const removed = [];
    const candidates = [];
    const idMap = {};      // videoId -> channelId (화면 카드가 채널을 못 알아볼 때 쓴다)
    (function walk(node) {
      if (Array.isArray(node)) {
        for (let i = node.length - 1; i >= 0; i--) {
          let blocked = false;
          try {
            const meta = metaFromItem(node[i]);
            if (meta && meta.title) {
              if (meta.videoId && meta.channelId) idMap[meta.videoId] = meta.channelId;
              const v = evaluate(meta, lists);
              if (v.action === 'block') {
                node.splice(i, 1);
                removed.push(Object.assign({ reason: v.reason }, meta));
                blocked = true;
              } else if (v.reason === 'music-clean' && meta.channelId && /^[\w-]{11}$/.test(meta.videoId || '')) {
                // 영상 ID 일 때만 후보로 삼는다 — 재생목록 ID(PL/RD/OLAK)는 시청 페이지로 못 연다
                candidates.push({ channelId: meta.channelId, channel: meta.channel,
                                  videoId: meta.videoId, views: meta.views });
              }
            }
          } catch (e) { /* 항목 하나 실패는 무시하고 계속 */ }
          if (!blocked) walk(node[i]);
        }
      } else if (node && typeof node === 'object') {
        for (const k in node) walk(node[k]);
      }
    })(rootNode);
    return { removed, candidates, idMap };
  }

  // 트리에서 첫 번째 비디오 videoId (자동재생 대체 후보 탐색용)
  function firstVideoId(node) {
    if (Array.isArray(node)) {
      for (const c of node) { const r = firstVideoId(c); if (r) return r; }
    } else if (node && typeof node === 'object') {
      const meta = metaFromItem(node);
      if (meta && meta.videoId && !meta.isPlaylist) return meta.videoId;
      for (const k in node) { const r = firstVideoId(node[k]); if (r) return r; }
    }
    return null;
  }

  // 유튜브 AI 공시는 두 자리에 실린다: ① 제목 옆 배지 ② 설명란 "콘텐츠 생성 방식" 섹션.
  // ②는 배지 없이 이것만 있는 영상이 실존한다(실사용 제보 2026-08-21).
  // 렌더러 이름 자체가 로케일 무관 신호다 — AI 영상에만 섹션이 존재하고
  // 정상 영상엔 아예 없다(실측 2026-08-21: AI 1 vs 정상 2 교차 확인).
  function hasAiDisclosure(data) {
    try {
      for (const p of data.engagementPanels || []) {
        const items = (((p.engagementPanelSectionListRenderer || {}).content || {})
          .structuredDescriptionContentRenderer || {}).items || [];
        for (const it of items) if (it && it.howThisWasMadeSectionViewModel) return true;
      }
    } catch (e) { /* 데이터 형태가 바뀌면 "없음"으로 — 다른 판별 층이 남아 있다 */ }
    return false;
  }

  const api = { evaluate, parseDuration, parseViews, filterTree, metaFromItem, firstVideoId, hasAiDisclosure, AI_STRONG, MUSIC_STRONG };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NAM_HEURISTICS = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
