#!/bin/bash
# Formats and lint-fixes any file Claude edits, silently.
# Purpose: Claude never spends tokens reading a file back to fix formatting,
# and never gets a diff full of whitespace churn.
input=$(cat)
file=$(echo "$input" | jq -r '.tool_input.file_path // empty')
[ -z "$file" ] && exit 0
[ -f "$file" ] || exit 0

case "$file" in
  *.ts|*.tsx|*.js|*.jsx|*.json|*.css|*.md)
    pnpm exec prettier --write "$file" >/dev/null 2>&1
    pnpm exec eslint --fix "$file" >/dev/null 2>&1
    ;;
esac
exit 0
