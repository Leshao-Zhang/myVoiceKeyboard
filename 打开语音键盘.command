#!/bin/bash
cd "$(dirname "$0")"
if [[ "$(uname -m)" == "arm64" ]]; then
  open "dist/mac-arm64/VoiceKeyboard.app"
else
  open "dist/mac/VoiceKeyboard.app"
fi
