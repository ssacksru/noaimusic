#!/usr/bin/env bash
# 배포용 zip 을 만든다. 테스트가 통과한 상태에서만 만들어진다.
set -euo pipefail
cd "$(dirname "$0")/.."

npm test >/dev/null
VERSION=$(node -p "require('./manifest.json').version")
OUT="dist/noaimusic-${VERSION}.zip"

rm -rf dist && mkdir -p dist
zip -qr "$OUT" \
  manifest.json \
  src/heuristics.js src/heuristics.iso.js src/page.js src/content.js src/content.css src/background.js \
  popup data icons \
  -x '*.DS_Store'

SIZE=$(du -h "$OUT" | awk '{print $1}')
COUNT=$(unzip -l "$OUT" | tail -1 | awk '{print $2}')
echo "빌드 완료: $OUT (${SIZE}, 파일 ${COUNT}개)"
echo "설치: chrome://extensions → 개발자 모드 → 압축해제된 확장 프로그램을 로드 (또는 이 zip 을 끌어다 놓기)"
