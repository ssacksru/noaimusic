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
    ].join('|'),
    'i'
  );

  // 맨몸 "AI"/"A.I." 토큰 — 대문자만, 영문자 인접 금지 ("PAID", "Aida" 등 오탐 방지)
  const AI_BARE = /(^|[^A-Za-z])A\.?I\.?(?![A-Za-z])/;

  // AI를 부정하는 표기 — "(NO AI)" 처럼 AI가 아님을 강조한 영상을 차단하면 정반대다.
  const AI_NEGATED = new RegExp(
    [
      'no[\\s\\-]*a\\.?i\\.?\\b', '\\bnon[\\s\\-]*a\\.?i\\.?\\b', 'a\\.?i\\.?[\\s\\-]*free\\b',
      'without\\s+a\\.?i\\.?', 'ai\\s*(아님|아니|없음|없이|미사용|안\\s*씀|배제)', 'ai\\s*x\\b',
      '사람이\\s*(만든|부른|작곡)', '실제\\s*(가수|사람)',
    ].join('|'),
    'i'
  );

  // AI 음악을 "듣는" 게 아니라 "설명하는" 영상 — 강의·튜토리얼·정보 콘텐츠.
  // 실측(2026-08-19) 검색 결과에서 이 유형이 20건 중 4건 나왔다.
  const ABOUT_AI = new RegExp(
    [
      '알려드립니다', '알려드릴', '정리해', '설명해', '강의', '튜토리얼', '만드는\\s*법', '만들기',
      '사용법', '방법', '따라하', '수익', '돈\\s*(버는|벌기|되는|안되는)', '후기', '비교',
      '이유\\s*\\d*가지', '총정리', '가이드', '\\bhow\\s+to\\b', '\\btutorial\\b', '\\bexplained\\b',
      '\\breview\\b', '\\bvs\\.?\\b', '노하우', '꿀팁', '초보',
    ].join('|'),
    'i'
  );

  function parseDuration(text) {
    if (!text || typeof text !== 'string') return 0;
    const m = text.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
    if (!m) return 0;
    return (Number(m[1]) || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
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

    const isMusic =
      MUSIC_STRONG.test(text) ||
      (MUSIC_WEAK.test(text) && (meta.isPlaylist || (meta.durationSec || 0) >= LONG_VIDEO_SEC));
    if (!isMusic) return { action: 'pass', reason: 'not-music' };

    // AI가 아님을 명시했거나, AI 음악을 설명하는 영상이면 차단하지 않는다
    if (AI_NEGATED.test(text)) return { action: 'pass', reason: 'ai-negated' };
    if (ABOUT_AI.test(title)) return { action: 'pass', reason: 'about-ai' };

    const strong = text.match(AI_STRONG);
    if (strong) return { action: 'block', reason: 'keyword:' + strong[0].trim() };
    const bare = text.match(AI_BARE);
    if (bare) return { action: 'block', reason: 'keyword:AI' };

    // 음악인데 AI 신호 없음 — 프로파일링 후보
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

  // 트리 전체를 순회하며 차단 판정 항목을 배열에서 제거. 제거된 메타 목록 반환.
  // 어떤 예외도 밖으로 던지지 않는다 — 실패 시 그 서브트리는 그대로 둔다.
  function filterTree(rootNode, lists) {
    const removed = [];
    (function walk(node) {
      if (Array.isArray(node)) {
        for (let i = node.length - 1; i >= 0; i--) {
          let blocked = false;
          try {
            const meta = metaFromItem(node[i]);
            if (meta && meta.title) {
              const v = evaluate(meta, lists);
              if (v.action === 'block') {
                node.splice(i, 1);
                removed.push(Object.assign({ reason: v.reason }, meta));
                blocked = true;
              }
            }
          } catch (e) { /* 항목 하나 실패는 무시하고 계속 */ }
          if (!blocked) walk(node[i]);
        }
      } else if (node && typeof node === 'object') {
        for (const k in node) walk(node[k]);
      }
    })(rootNode);
    return removed;
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

  const api = { evaluate, parseDuration, filterTree, metaFromItem, firstVideoId, AI_STRONG, MUSIC_STRONG };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NAM_HEURISTICS = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
