#!/usr/bin/env bash
# Prepares a checkout for `npm run test:e2e`. Safe to run repeatedly; it does
# nothing once everything is in place. Runs at session start in cloud sessions
# (see .claude/settings.json). Unit tests need none of this.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# The end-to-end tests drive Chrome through an X server, so they are Linux only.
if [ "$(uname -s)" != "Linux" ]; then
  exit 0
fi

if [ ! -d node_modules/puppeteer-core ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm ci --no-audit --no-fund --loglevel=error >&2
fi

python_has() { python3 -c "import $1" >/dev/null 2>&1; }
pip_install() {
  # --break-system-packages is needed on distro Pythons and unknown to old pips.
  python3 -m pip install --quiet --break-system-packages "$1" 2>/dev/null || python3 -m pip install --quiet "$1"
}
python_has Xlib || pip_install python-xlib
python_has PIL || pip_install pillow

missing=()
command -v xvfb-run >/dev/null 2>&1 || missing+=("xvfb-run (apt-get install xvfb)")
chrome="${CHROME_PATH:-}"
if [ -z "$chrome" ]; then
  for candidate in /usr/bin/google-chrome /usr/bin/chromium /usr/bin/chromium-browser; do
    if [ -x "$candidate" ]; then chrome="$candidate"; break; fi
  done
fi
[ -n "$chrome" ] && [ -x "$chrome" ] || missing+=("Chrome for Testing (npx @puppeteer/browsers install chrome@stable, then set CHROME_PATH)")

if [ "${#missing[@]}" -gt 0 ]; then
  echo "setup: npm run test:e2e cannot run yet. Missing:" >&2
  printf '  - %s\n' "${missing[@]}" >&2
fi
