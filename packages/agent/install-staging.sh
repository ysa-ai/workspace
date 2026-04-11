#!/bin/bash
set -e

REPO="ysa-ai/platform"
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

if [ -z "$YSA_PLATFORM_GH_TOKEN" ]; then
  echo "YSA_PLATFORM_GH_TOKEN is required to download private artifacts"
  echo "  export YSA_PLATFORM_GH_TOKEN=<your PAT with actions:read on ysa-ai/platform>"
  exit 1
fi

echo "Fetching latest staging build..."
RUN_ID=$(curl -fsSL \
  -H "Authorization: Bearer $YSA_PLATFORM_GH_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/${REPO}/actions/workflows/release-agent-staging.yml/runs?status=success&per_page=1" \
  | grep '"id"' | head -1 | sed 's/[^0-9]//g')

if [ -z "$RUN_ID" ]; then
  echo "No successful staging build found. Trigger one from the Actions tab first."
  exit 1
fi

ARTIFACT_ID=$(curl -fsSL \
  -H "Authorization: Bearer $YSA_PLATFORM_GH_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/${REPO}/actions/runs/${RUN_ID}/artifacts" \
  | grep -B3 '"ysa-agent-staging"' | grep '"id"' | head -1 | sed 's/[^0-9]//g')

if [ -z "$ARTIFACT_ID" ]; then
  echo "Artifact not found in run ${RUN_ID}"
  exit 1
fi

TMP=$(mktemp -d)
echo "Downloading artifact..."
curl -fsSL \
  -H "Authorization: Bearer $YSA_PLATFORM_GH_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/${REPO}/actions/artifacts/${ARTIFACT_ID}/zip" \
  -o "${TMP}/artifact.zip"

unzip -q "${TMP}/artifact.zip" -d "${TMP}"

BINARY="${TMP}/ysa-agent-staging-${OS}-${ARCH}"
if [ ! -f "$BINARY" ]; then
  echo "Binary not found in artifact: ysa-agent-staging-${OS}-${ARCH}"
  exit 1
fi

mkdir -p "$BIN_DIR"
mv "$BINARY" "${BIN_DIR}/ysa-agent-staging"
chmod +x "${BIN_DIR}/ysa-agent-staging"
rm -rf "$TMP"

echo ""
echo "ysa-agent-staging installed to ${BIN_DIR}/ysa-agent-staging"
if ! echo "$PATH" | grep -q "$BIN_DIR"; then
  echo "  Add to your shell: export PATH=\"\$HOME/.local/bin:\$PATH\""
fi
