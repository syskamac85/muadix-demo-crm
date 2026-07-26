#!/usr/bin/env bash
set -euo pipefail

bash /opt/render/project/src/scripts/download-chrome.sh
cd /opt/render/project/src/apps/api
exec celery -A api worker -l info --concurrency=2 --prefetch-multiplier=1 --max-tasks-per-child=50
