#!/usr/bin/env bash
# Safari(macOS) 래퍼 앱을 빌드한다. 크롬용 zip 을 그대로 Xcode 프로젝트의 리소스로 동기화한 뒤
#   dev     : 개발 서명 빌드 → ~/Applications 에 설치해 사파리에 등록 (로컬 실측용)
#   archive : Release 아카이브 → App Store Connect 용 .pkg export (업로드는 하지 않는다)
#   upload  : export 된 .pkg 를 altool 로 업로드 (명시적으로 부를 때만)
# 전제: tools/build.sh 가 테스트를 돌리고 zip 을 만든다. 여기서도 그 zip 만 쓴다.
set -euo pipefail
cd "$(dirname "$0")/.."
MODE="${1:-dev}"

TEAM="DS8Q52AV7Y"
PROJ="safari/NoAI Music/NoAI Music.xcodeproj"
SCHEME="NoAI Music"
RES="safari/NoAI Music/NoAI Music Extension/Resources"
BUILD="safari/build"
KEY_ID="${ASC_KEY_ID:-K6AH7HUK6R}"
ISSUER_ID="${ASC_ISSUER_ID:-f42a55f5-66a9-4e9e-a7ce-ebb13f2f5f18}"
KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_${KEY_ID}.p8"
AUTH=(-allowProvisioningUpdates -authenticationKeyPath "$KEY_PATH" -authenticationKeyID "$KEY_ID" -authenticationKeyIssuerID "$ISSUER_ID")

# 1) 테스트 + 크롬 zip
bash tools/build.sh >/dev/null
VERSION=$(node -p "require('./manifest.json').version")
ZIP="dist/noaimusic-${VERSION}.zip"

# 2) 리소스 동기화 — zip 이 담은 파일만 (Xcode 는 이 폴더를 통째로 번들에 넣는다)
rm -rf "$RES" && mkdir -p "$RES" && unzip -q "$ZIP" -d "$RES"

# 3) 버전을 manifest 와 맞춘다 (앱·확장 둘 다; 익스텐션 버전이 앱과 다르면 업로드 경고)
sed -i '' "s/MARKETING_VERSION = [^;]*;/MARKETING_VERSION = ${VERSION};/g" "$PROJ/project.pbxproj"
if [ -n "${BUILD_NUMBER:-}" ]; then
  sed -i '' "s/CURRENT_PROJECT_VERSION = [^;]*;/CURRENT_PROJECT_VERSION = ${BUILD_NUMBER};/g" "$PROJ/project.pbxproj"
fi

case "$MODE" in
  dev)
    xcodebuild -project "$PROJ" -scheme "$SCHEME" -configuration Debug -derivedDataPath "$BUILD/dd" \
      DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Automatic "${AUTH[@]}" build 2>&1 | grep -E 'error:|BUILD ' || true
    APP="$BUILD/dd/Build/Products/Debug/NoAI Music.app"
    [ -d "$APP" ] || { echo "빌드 실패"; exit 1; }
    mkdir -p ~/Applications && rm -rf ~/Applications/"NoAI Music.app" && cp -R "$APP" ~/Applications/
    open ~/Applications/"NoAI Music.app"; sleep 2; osascript -e 'tell application "NoAI Music" to quit' >/dev/null 2>&1 || true
    echo "설치 완료: ~/Applications/NoAI Music.app (v${VERSION}) → Safari 설정 › 확장 프로그램에서 켠다"
    ;;
  archive)
    LOG="$BUILD/archive.log"; ARCHIVE="$BUILD/NoAI Music.xcarchive"; EXPORT="$BUILD/export"
    rm -rf "$ARCHIVE" "$EXPORT"; mkdir -p "$BUILD"
    echo "아카이브 중… (로그: $LOG)"
    xcodebuild -project "$PROJ" -scheme "$SCHEME" -configuration Release -destination 'generic/platform=macOS' \
      -archivePath "$ARCHIVE" DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Automatic "${AUTH[@]}" archive > "$LOG" 2>&1 \
      || { echo "아카이브 실패:"; grep -E 'error:' "$LOG" | tail -5; exit 1; }
    echo "배포 프로파일 갱신(API)…"; python3 tools/asc-profiles.py
    # 인스톨러 서명 키는 전용 빌드 키체인에 있다(재부팅하면 잠김) — export 전에 풀어 둔다 (가이드 §7.5.1)
    BK="$HOME/Library/Keychains/videotriage-build.keychain-db"; BP="$HOME/.appstoreconnect/build-keychain-pass.txt"
    [ -f "$BP" ] && security unlock-keychain -p "$(cat "$BP")" "$BK" 2>/dev/null || echo "⚠️ 빌드 키체인 잠금 해제 실패 — productbuild 가 멈추면 이것 때문"
    echo "export 중…"
    xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportOptionsPlist safari/ExportOptions.plist \
      -exportPath "$EXPORT" "${AUTH[@]}" >> "$LOG" 2>&1 \
      || { echo "export 실패:"; grep -E 'error:' "$LOG" | tail -5; exit 1; }
    PKG=$(ls "$EXPORT"/*.pkg | head -1)
    echo "export 완료: $PKG"
    echo "검증: xcrun altool --validate-app -f \"$PKG\" -t macos --apiKey $KEY_ID --apiIssuer $ISSUER_ID"
    ;;
  upload)
    PKG=$(ls "$BUILD"/export/*.pkg | head -1)
    xcrun altool --upload-app -f "$PKG" -t macos --apiKey "$KEY_ID" --apiIssuer "$ISSUER_ID"
    ;;
  *) echo "사용법: tools/build-safari.sh [dev|archive|upload]"; exit 2 ;;
esac
