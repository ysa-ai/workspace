#!/bin/bash
set -e

REPO="ysa-ai/agent"
BIN_DIR="${HOME}/.local/bin"

OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
case "$ARCH" in
  x86_64)        ARCH="x64"   ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) echo "Unsupported arch: $ARCH" && exit 1 ;;
esac
case "$OS" in
  darwin|linux) ;;
  *) echo "Unsupported OS: $OS" && exit 1 ;;
esac

TAG=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')
BINARY="ysa-agent-${OS}-${ARCH}"
URL="https://github.com/${REPO}/releases/download/${TAG}/${BINARY}"

mkdir -p "$BIN_DIR"
curl -fsSL "$URL" -o "${BIN_DIR}/ysa-agent"
chmod +x "${BIN_DIR}/ysa-agent"

echo ""
echo "ysa-agent ${TAG} installed to ${BIN_DIR}/ysa-agent"
if ! echo "$PATH" | grep -q "$BIN_DIR"; then
  echo "  Add to your shell: export PATH=\"\$HOME/.local/bin:\$PATH\""
fi
