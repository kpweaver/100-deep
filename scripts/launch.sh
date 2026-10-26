#!/bin/sh
# One-step launcher: set up (first run), build, start the game and open the
# browser.  Used by "100 Deep.command" and "100 Deep.app".
# Closing the window or pressing Ctrl+C saves the game and quits.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

# Finder/Dock launches get a minimal PATH; add the usual tool locations
PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$HOME/.nvm/current/bin:$PATH"
export PATH

pause_and_exit() {
  echo
  printf 'Press Return to close this window. '
  read -r _
  exit 1
}

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "100 Deep needs '$1' but it was not found."
    echo "$2"
    pause_and_exit
  fi
}

echo "=== 100 Deep ==="
need node "Install Node.js 23.6 or newer (https://nodejs.org or: brew install node)."
need cmake "Install CMake (https://cmake.org or: brew install cmake)."
need cc "Install the Xcode command line tools: xcode-select --install"

NODE_MAJOR="$(node -p 'process.versions.node.split(".").map(Number).reduce((a, v, i) => i === 0 ? v * 100 : i === 1 ? a + v : a, 0)')"
if [ "$NODE_MAJOR" -lt 2306 ]; then
  echo "Node.js $(node -v) is too old; version 23.6 or newer is required."
  pause_and_exit
fi

if [ ! -f engine/upstream/src/game-world.c ]; then
  echo "Fetching the Angband engine (first run)..."
  git submodule update --init engine/upstream || pause_and_exit
fi

if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "Installing dependencies (first run)..."
  npm install --no-audit --no-fund || pause_and_exit
fi

echo "Building (only what changed)..."
sh scripts/build-engine.sh >/dev/null || { echo "Engine build failed:"; sh scripts/build-engine.sh; pause_and_exit; }
npm run --silent build:client >/dev/null || { echo "Client build failed:"; npm run build:client; pause_and_exit; }

echo "Starting... (close this window or press Ctrl+C to save and quit)"
node bridge/src/index.ts --open "$@"
STATUS=$?
# Keep the window open if startup failed so the message can be read
[ "$STATUS" -ne 0 ] && pause_and_exit
exit 0
