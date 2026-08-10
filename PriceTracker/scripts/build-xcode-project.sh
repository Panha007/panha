#!/usr/bin/env bash
#
# Generate a buildable Safari App Extension Xcode project from the web-extension
# resources, using Apple's official converter. Run this on a Mac with Xcode
# installed. The generated project wraps ./Extension/Resources into a host app
# plus a Safari Web Extension target that you can build and run.
#
# Usage:
#   ./scripts/build-xcode-project.sh              # macOS + iOS app
#   ./scripts/build-xcode-project.sh --macos-only # macOS only
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RESOURCES="$HERE/Extension/Resources"
OUTPUT="$HERE/xcode"

APP_NAME="Price Tracker"
BUNDLE_ID="com.example.pricetracker"

EXTRA_ARGS=()
if [[ "${1:-}" == "--macos-only" ]]; then
  EXTRA_ARGS+=("--macos-only")
fi

if ! xcrun --find safari-web-extension-converter >/dev/null 2>&1; then
  echo "error: safari-web-extension-converter not found." >&2
  echo "       Install Xcode (from the Mac App Store) and its command line tools." >&2
  exit 1
fi

echo "Converting $RESOURCES -> $OUTPUT"
mkdir -p "$OUTPUT"

xcrun safari-web-extension-converter "$RESOURCES" \
  --project-location "$OUTPUT" \
  --app-name "$APP_NAME" \
  --bundle-identifier "$BUNDLE_ID" \
  --no-open \
  --force \
  "${EXTRA_ARGS[@]}"

echo
echo "Done. Open the generated project:"
echo "  open \"$OUTPUT/$APP_NAME/$APP_NAME.xcodeproj\""
echo
echo "Then in Xcode: select the app target, set your Team under Signing &"
echo "Capabilities, and press Run. Finally enable the extension in Safari:"
echo "  Safari > Settings > Extensions > Price Tracker (tick to enable)."
