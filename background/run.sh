#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/background/.build"
BIN="$BUILD/keysound"
mkdir -p "$BUILD"

swiftc -O -framework AppKit -framework AVFoundation -framework ApplicationServices \
  -o "$BIN" "$ROOT/background/KeySound.swift"

exec "$BIN" "$ROOT"
