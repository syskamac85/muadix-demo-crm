#!/usr/bin/env bash
set -euo pipefail

bash /opt/render/project/src/scripts/download-chrome.sh
cd /opt/render/project/src/apps/api
exec daphne -b 0.0.0.0 -p "${PORT:-10000}" api.asgi:application
