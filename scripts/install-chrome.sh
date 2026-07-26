#!/usr/bin/env bash
set -euo pipefail

if command -v chromedriver >/dev/null 2>&1 && command -v chromium >/dev/null 2>&1; then
  echo "Chromium and chromedriver already installed."
  exit 0
fi

echo "Installing Chromium and chromedriver..."
export DEBIAN_FRONTEND=noninteractive
sudo mkdir -p /var/lib/apt/lists/partial
sudo chown -R root:root /var/lib/apt/lists
sudo apt-get update
sudo apt-get install -y --no-install-recommends chromium chromium-driver libgconf-2-4 libnss3 libatk-bridge2.0-0 libgtk-3-0
sudo apt-get clean
sudo rm -rf /var/lib/apt/lists/*

if command -v chromedriver >/dev/null 2>&1; then
  echo "Chromedriver installation successful."
else
  echo "Chromedriver installation failed." >&2
  exit 1
fi
