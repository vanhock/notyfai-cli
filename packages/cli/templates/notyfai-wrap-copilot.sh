#!/usr/bin/env bash
set -e
EVENT="${1:?Usage: notyfai-wrap.sh <eventName>}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v jq >/dev/null 2>&1; then
  echo "Notyfai: jq is required for Copilot hooks. Install with: brew install jq" >&2
  exit 1
fi

PAYLOAD=$(cat)
CWD=$(echo "$PAYLOAD" | jq -r '.cwd // empty')
SESSION_KEY=$(echo -n "${CWD:-unknown}" | shasum -a 256 2>/dev/null | awk '{print $1}' || \
              echo -n "${CWD:-unknown}" | sha256sum 2>/dev/null | awk '{print $1}' || echo "fallback")
STATE_FILE="/tmp/notyfai-copilot-${SESSION_KEY}"

if [ "$EVENT" = "sessionStart" ]; then
  SESSION_ID=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid 2>/dev/null || openssl rand -hex 16)
  printf '%s\n%s\n' "$SESSION_ID" "0" > "$STATE_FILE"
fi

SESSION_ID=$(sed -n '1p' "$STATE_FILE" 2>/dev/null || echo "")
TURN=$(sed -n '2p' "$STATE_FILE" 2>/dev/null || echo "0")

if [ "$EVENT" = "userPromptSubmitted" ] && [ -n "$SESSION_ID" ]; then
  TURN=$(( TURN + 1 ))
  printf '%s\n%s\n' "$SESSION_ID" "$TURN" > "$STATE_FILE"
fi

GEN_ID="${SESSION_ID:+${SESSION_ID}-turn-${TURN}}"

ENRICHED=$(echo "$PAYLOAD" | jq -c \
  --arg ev "$EVENT" \
  --arg sid "$SESSION_ID" \
  --arg gid "$GEN_ID" \
  '. + {hook_event_name: $ev}
     + (if $sid != "" then {session_id: $sid} else {} end)
     + (if $gid != "" then {generation_id: $gid} else {} end)')
echo "$ENRICHED" | "$SCRIPT_DIR/notyfai-send.sh"

if [ "$EVENT" = "sessionEnd" ]; then
  rm -f "$STATE_FILE"
fi
