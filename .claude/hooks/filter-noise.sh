#!/bin/bash
# Trims the most token-expensive command output before Claude ever sees it.
# A failing test suite prints thousands of lines; Claude only needs the failures.
input=$(cat)
cmd=$(echo "$input" | jq -r '.tool_input.command // empty')
[ -z "$cmd" ] && echo '{}' && exit 0

rewrite() {
  esc=$(printf '%s' "$1" | jq -Rs .)
  echo "{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"allow\",\"updatedInput\":{\"command\":$esc}}}"
  exit 0
}

case "$cmd" in
  # Test runs: failures only
  "pnpm test"*|"npm test"*|"vitest"*|"pnpm exec vitest"*)
    rewrite "$cmd 2>&1 | grep -E -A 8 '(FAIL|✗|×|Error:|AssertionError)' | head -120" ;;
  # Type errors only, not the success banner
  "pnpm typecheck"*|"tsc"*|"pnpm exec tsc"*)
    rewrite "$cmd 2>&1 | grep -E 'error TS' | head -60" ;;
  # Installs are pure noise
  "pnpm install"*|"pnpm add"*|"npm install"*)
    rewrite "$cmd 2>&1 | tail -12" ;;
  # Builds: only the failure
  "pnpm build"*|"next build"*)
    rewrite "$cmd 2>&1 | grep -E -B2 -A 8 '(Error|Failed|error TS)' | head -100" ;;
esac
echo '{}'
