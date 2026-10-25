#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v ffmpeg >/dev/null || { echo 'Install FFmpeg first (macOS: brew install ffmpeg).'; exit 1; }
command -v ffprobe >/dev/null
node -e 'if(Number(process.versions.node.split(".")[0])<22)throw Error("Node.js 22+ required")'
npm ci
npm run typecheck
npm run test
npm run lint
