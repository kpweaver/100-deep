#!/bin/sh
# Build the headless Angband engine (unmodified upstream core + adapter).
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ ! -f "$ROOT/engine/upstream/src/game-world.c" ]; then
  git -C "$ROOT" submodule update --init engine/upstream
fi
JOBS="$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)"
cmake -S "$ROOT/engine" -B "$ROOT/build/engine" -DCMAKE_BUILD_TYPE=RelWithDebInfo >/dev/null
cmake --build "$ROOT/build/engine" --target angband-headless -j "$JOBS"
echo "Built $ROOT/build/engine/angband-headless"
