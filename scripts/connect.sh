#!/usr/bin/env bash
# Registers this Bolna MCP server in your own Claude Code config
# (--scope user: personal to you, works across all your projects).
set -euo pipefail

URL="${BOLNA_MCP_URL:-https://bolna-mcp-eta.vercel.app/api/mcp}"

if ! command -v claude >/dev/null 2>&1; then
  echo "claude CLI not found. Install it first: curl -fsSL https://claude.ai/install.sh | bash" >&2
  exit 1
fi

read -rsp "Bolna API key: " BOLNA_KEY
echo
if [ -z "$BOLNA_KEY" ]; then
  echo "No key entered, aborting." >&2
  exit 1
fi

claude mcp add --transport http bolna-mcp "$URL" \
  --header "Authorization: Bearer $BOLNA_KEY" \
  --scope user

echo "Added. Run 'claude mcp list' to verify, then start a new Claude Code session."
