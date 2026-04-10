#!/usr/bin/env bash
HOOK_URL="${NOTYFAI_HOOK_URL:-$(cat ".gemini/notyfai-url" 2>/dev/null)}"
if [ -z "$HOOK_URL" ]; then
  echo '{"reason":"NotyfAI: no hook URL in NOTYFAI_HOOK_URL or .gemini/notyfai-url"}' >&2
  exit 2
fi
PAYLOAD=$(cat)
(curl -s -o /dev/null -X POST -H "Content-Type: application/json" -d "$PAYLOAD" "$HOOK_URL" 2>/dev/null &)
echo '{}'
exit 0
