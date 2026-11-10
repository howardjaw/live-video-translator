#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
ffmpeg -v error -y -f lavfi -i 'testsrc2=size=640x360:rate=30' -f lavfi -i 'sine=frequency=220:sample_rate=24000' -t 8 -c:v libx264 -pix_fmt yuv420p -c:a aac -movflags +faststart demo/sample.mp4
