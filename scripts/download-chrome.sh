#!/usr/bin/env bash
set -euo pipefail

CHROME_VERSION="${CHROME_VERSION:-127.0.6533.72}"
BASE_URL="https://storage.googleapis.com/chrome-for-testing-public"
TMP_DIR="/tmp/chrome-download"
INSTALL_ROOT="${INSTALL_ROOT:-/opt/render/project/src/.chrome}" # persistent across restarts
CHROME_ARCHIVE="chrome-linux64.zip"
DRIVER_ARCHIVE="chromedriver-linux64.zip"

CHROME_PATH="$INSTALL_ROOT/chrome/chrome"
DRIVER_PATH="$INSTALL_ROOT/chromedriver/chromedriver"

if [ -x "$CHROME_PATH" ] && [ -x "$DRIVER_PATH" ]; then
  echo "Chrome already installed at $CHROME_PATH"
  exit 0
fi

rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"
mkdir -p "$INSTALL_ROOT"

echo "Downloading Chrome version $CHROME_VERSION..."
curl -fsSL "$BASE_URL/$CHROME_VERSION/linux64/$CHROME_ARCHIVE" -o "$TMP_DIR/$CHROME_ARCHIVE"
curl -fsSL "$BASE_URL/$CHROME_VERSION/linux64/$DRIVER_ARCHIVE" -o "$TMP_DIR/$DRIVER_ARCHIVE"

unzip -oq "$TMP_DIR/$CHROME_ARCHIVE" -d "$TMP_DIR"
unzip -oq "$TMP_DIR/$DRIVER_ARCHIVE" -d "$TMP_DIR"

rm -rf "$INSTALL_ROOT/chrome" "$INSTALL_ROOT/chromedriver"
mv "$TMP_DIR/chrome-linux64" "$INSTALL_ROOT/chrome"
mv "$TMP_DIR/chromedriver-linux64" "$INSTALL_ROOT/chromedriver"

chmod +x "$INSTALL_ROOT/chrome/chrome"
chmod +x "$INSTALL_ROOT/chromedriver/chromedriver"

echo "Chrome installed at $CHROME_PATH"
echo "ChromeDriver installed at $DRIVER_PATH"
