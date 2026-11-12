#!/usr/bin/env bash
# Installs the APK on the running emulator, runs the Maestro smoke flow and collects
# screenshots. Used by the "Android APK" workflow; also works locally.
set -uo pipefail

APK="${1:-out/gupit-goa.apk}"
mkdir -p screens
adb install -r "$APK"

if ! command -v maestro >/dev/null 2>&1; then
  curl -fsSL "https://get.maestro.mobile.dev" | bash
  export PATH="$HOME/.maestro/bin:$PATH"
fi

maestro test .maestro/smoke.yaml
STATUS=$?

# Always leave evidence behind, pass or fail.
adb exec-out screencap -p > screens/99-final-state.png || true
adb logcat -d -t 400 > screens/logcat.txt || true
exit $STATUS
