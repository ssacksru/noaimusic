#!/usr/bin/env bash
# 배포용 zip 을 만든다. 테스트가 통과한 상태에서만, manifest 가 참조하는 파일만 담는다.
# (파일 목록을 손으로 적으면 새 파일을 빠뜨린다 — 실제로 lists.js 를 빠뜨린 적이 있다.)
set -euo pipefail
cd "$(dirname "$0")/.."

npm test >/dev/null
VERSION=$(node -p "require('./manifest.json').version")
OUT="dist/noaimusic-${VERSION}.zip"

FILES=$(node -e '
const m = require("./manifest.json");
const out = new Set(["manifest.json"]);
out.add(m.background.service_worker);
out.add(m.action.default_popup);
Object.values(m.icons).forEach((f) => out.add(f));
Object.values(m.action.default_icon || {}).forEach((f) => out.add(f));
for (const c of m.content_scripts) [...(c.js||[]), ...(c.css||[])].forEach((f) => out.add(f));
for (const w of m.web_accessible_resources) w.resources.forEach((f) => out.add(f));
// default_locale 선언 시 _locales 트리 필수 — 빠지면 설치 자체가 거부된다
if (m.default_locale) {
  const fs = require("fs");
  for (const d of fs.readdirSync("_locales")) out.add("_locales/" + d + "/messages.json");
}
console.log([...out].join("\n"));
')

# 팝업이 <script>/<link> 로 부르는 파일도 함께 담는다
POPUP_DIR=$(dirname "$(node -p "require('./manifest.json').action.default_popup")")
EXTRA=$(node -e '
const fs = require("fs"), path = require("path");
const p = require("./manifest.json").action.default_popup;
const html = fs.readFileSync(p, "utf8");
const dir = path.dirname(p);
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1])
  .filter((u) => !/^https?:|^data:/.test(u));
console.log(refs.map((u) => path.normalize(path.join(dir, u))).join("\n"));
')

rm -rf dist && mkdir -p dist
printf '%s\n%s\n' "$FILES" "$EXTRA" | sort -u | grep -v '^$' > dist/.filelist

MISSING=$(while read -r f; do [ -e "$f" ] || echo "$f"; done < dist/.filelist)
if [ -n "$MISSING" ]; then echo "빌드 실패 — 없는 파일: $MISSING"; exit 1; fi

zip -q "$OUT" -@ < dist/.filelist
rm -f dist/.filelist

SIZE=$(du -h "$OUT" | awk '{print $1}')
COUNT=$(unzip -l "$OUT" | tail -1 | awk '{print $2}')
echo "빌드 완료: $OUT (${SIZE}, 파일 ${COUNT}개)"
echo "설치: chrome://extensions → 개발자 모드 → 압축해제된 확장 프로그램을 로드"
