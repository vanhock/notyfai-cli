#!/usr/bin/env bash
set -e
HOOK_URL="${NOTYFAI_HOOK_URL:-$(cat ".windsurf/notyfai-url" 2>/dev/null)}"
HOOK_URL="${HOOK_URL:-$(cat ~/.codeium/windsurf/notyfai-url 2>/dev/null)}"
if [ -z "$HOOK_URL" ]; then
  echo "Notyfai: set .windsurf/notyfai-url or NOTYFAI_HOOK_URL" >&2
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
[ -z "$NOTYFAI_TOKEN" ] && NOTYFAI_TOKEN="${NOTYFAI_HOOK_TOKEN:-$(cat ".windsurf/notyfai-token" 2>/dev/null)}"
[ -z "$NOTYFAI_TOKEN" ] && NOTYFAI_TOKEN="$(cat ~/.codeium/windsurf/notyfai-token 2>/dev/null)"
if [ -z "$NOTYFAI_TOKEN" ] && [ "${HOOK_URL#*token=}" = "$HOOK_URL" ]; then
  echo "Notyfai: no token in URL and none in NOTYFAI_HOOK_TOKEN or .windsurf/notyfai-token" >&2
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
if [ "${REQUEST_URL#https://}" != "$REQUEST_URL" ]; then
  curl -sS -X POST -H "Content-Type: application/json" \
    ${NOTYFAI_TOKEN:+ -H "x-notyfai-token: $NOTYFAI_TOKEN"} \
    --proto '=https' --tlsv1.2 \
    -d @- "$REQUEST_URL" || true
else
  curl -sS -X POST -H "Content-Type: application/json" \
    ${NOTYFAI_TOKEN:+ -H "x-notyfai-token: $NOTYFAI_TOKEN"} \
    -d @- "$REQUEST_URL" || true
fi
exit 0
