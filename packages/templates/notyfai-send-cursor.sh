#!/usr/bin/env bash
# Notyfai Cursor hook: read JSON from stdin, POST to hook URL.
# Deduplicates tool events only (same key within 2s skipped). sessionStart, sessionEnd, beforeSubmitPrompt, afterAgentResponse, stop always sent.
# URL lookup order: NOTYFAI_HOOK_URL env var -> .cursor/notyfai-url (project) -> ~/.cursor/notyfai-url (global fallback)

set -e

HOOK_URL="${NOTYFAI_HOOK_URL:-$(cat "${CURSOR_PROJECT_DIR:-.}/.cursor/notyfai-url" 2>/dev/null)}"
HOOK_URL="${HOOK_URL:-$(cat ~/.cursor/notyfai-url 2>/dev/null)}"
if [ -z "$HOOK_URL" ]; then
  echo "Notyfai: run setup from the app in your project root, or set NOTYFAI_HOOK_URL" >&2
  exit 1
fi

REQUEST_URL="$HOOK_URL"
NOTYFAI_TOKEN=""
if [ "${HOOK_URL#*token=}" != "$HOOK_URL" ]; then
  NOTYFAI_TOKEN="${HOOK_URL#*token=}"
  NOTYFAI_TOKEN="${NOTYFAI_TOKEN%%&*}"
  base="${HOOK_URL%%\?*}"
  if [ "${HOOK_URL#*\?}" != "$HOOK_URL" ]; then
    q="${HOOK_URL#*\?}"
    q=$(echo "$q" | sed 's/&token=[^&]*//g; s/^token=[^&]*&*//; s/^&//; s/&$//')
    [ -n "$q" ] && REQUEST_URL="$base?$q" || REQUEST_URL="$base"
  else
    REQUEST_URL="$base"
  fi
fi
[ -z "$NOTYFAI_TOKEN" ] && NOTYFAI_TOKEN="${NOTYFAI_HOOK_TOKEN:-$(cat "${CURSOR_PROJECT_DIR:-.}/.cursor/notyfai-token" 2>/dev/null)}"
[ -z "$NOTYFAI_TOKEN" ] && NOTYFAI_TOKEN="$(cat ~/.cursor/notyfai-token 2>/dev/null)"
if [ -z "$NOTYFAI_TOKEN" ] && [ "${HOOK_URL#*token=}" = "$HOOK_URL" ]; then
  echo "Notyfai: no token in URL and none in NOTYFAI_HOOK_TOKEN or .cursor/notyfai-token" >&2
  exit 1
fi
if [ "${REQUEST_URL#https://}" = "$REQUEST_URL" ]; then
  case "$REQUEST_URL" in
    http://127.0.0.1*|http://localhost*) ;;
    *)
      if [ "${NOTYFAI_INSECURE:-0}" != "1" ]; then
        echo "Notyfai: hook URL must use https:// (use NOTYFAI_INSECURE=1 for local HTTP)." >&2
        exit 1
      fi
      ;;
  esac
fi

PAYLOAD_FILE=""
cleanup() {
  [ -n "$PAYLOAD_FILE" ] && [ -f "$PAYLOAD_FILE" ] && rm -f "$PAYLOAD_FILE"
}
trap cleanup EXIT
PAYLOAD_FILE="$(mktemp -t notyfai-payload.XXXXXX.json)"
cat > "$PAYLOAD_FILE"

if command -v jq >/dev/null 2>&1; then
  EVENT="$(jq -r '.hook_event_name // empty' "$PAYLOAD_FILE")"
  case "$EVENT" in
    beforeReadFile|beforeTabFileRead|afterFileEdit) exit 0 ;;
  esac
fi

SKIP_DEDUPE=0
if command -v jq >/dev/null 2>&1; then
  EVENT="$(jq -r '.hook_event_name // empty' "$PAYLOAD_FILE")"
  case "$EVENT" in
    sessionStart|sessionEnd|beforeSubmitPrompt|afterAgentResponse|stop) SKIP_DEDUPE=1 ;;
    "") SKIP_DEDUPE=1 ;;
  esac
fi

DEDUPE_SECONDS="${NOTYFAI_DEDUPE_SECONDS:-2}"
STATE_FILE="${NOTYFAI_STATE_FILE:-$HOME/.cursor/notyfai-send-state}"
NOW="$(date +%s)"

if [ "$SKIP_DEDUPE" -eq 0 ] && command -v jq >/dev/null 2>&1; then
  EVENT="$(jq -r '.hook_event_name // empty' "$PAYLOAD_FILE")"
  CONV="$(jq -r '.conversation_id // empty' "$PAYLOAD_FILE")"
  GEN="$(jq -r '.generation_id // empty' "$PAYLOAD_FILE")"
  TOOL_NAME="$(jq -r '.tool_name // empty' "$PAYLOAD_FILE")"
  TOOL_USE_ID="$(jq -r '.tool_use_id // empty' "$PAYLOAD_FILE")"
  KEY="${EVENT}|${CONV}|${GEN}|${TOOL_NAME}|${TOOL_USE_ID}"
  KEY_HASH="$(echo -n "$KEY" | shasum -a 256 2>/dev/null | awk '{print $1}')"
  if [ -z "$KEY_HASH" ]; then
    KEY_HASH="$(echo -n "$KEY" | sha256sum 2>/dev/null | awk '{print $1}')"
  fi
  if [ -n "$KEY_HASH" ] && [ -f "$STATE_FILE" ]; then
    read -r PREV_HASH PREV_TS < "$STATE_FILE" 2>/dev/null || true
    if [ "$KEY_HASH" = "$PREV_HASH" ] && [ -n "$PREV_TS" ]; then
      DIFF=$((NOW - PREV_TS))
      if [ "$DIFF" -ge 0 ] && [ "$DIFF" -lt "$DEDUPE_SECONDS" ]; then
        exit 0
      fi
    fi
  fi
fi

if [ "${REQUEST_URL#https://}" != "$REQUEST_URL" ]; then
  curl -s -f -X POST -H "Content-Type: application/json" \
    ${NOTYFAI_TOKEN:+ -H "x-notyfai-token: $NOTYFAI_TOKEN"} \
    --proto '=https' --tlsv1.2 \
    -d @"$PAYLOAD_FILE" "$REQUEST_URL"
else
  curl -s -f -X POST -H "Content-Type: application/json" \
    ${NOTYFAI_TOKEN:+ -H "x-notyfai-token: $NOTYFAI_TOKEN"} \
    -d @"$PAYLOAD_FILE" "$REQUEST_URL"
fi

if [ "$SKIP_DEDUPE" -eq 0 ] && [ -n "$KEY_HASH" ]; then
  mkdir -p "$(dirname "$STATE_FILE")"
  echo "$KEY_HASH $NOW" > "$STATE_FILE"
fi
