#!/usr/bin/env bash
set -euo pipefail
if [ -d ".venv" ]; then
  source .venv/bin/activate
fi
pyinstaller --name CatchBoard --onefile --add-data "data:data" main.py
