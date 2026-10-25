#!/usr/bin/env bash
# Explicit opt-in setup: PocketSphinx includes a small English acoustic model.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 -m venv .venv
CMAKE_BUILD_PARALLEL_LEVEL="${CMAKE_BUILD_PARALLEL_LEVEL:-2}" .venv/bin/pip install --disable-pip-version-check -r requirements-alignment.txt
.venv/bin/python scripts/speech.py --status
