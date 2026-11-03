#!/usr/bin/env bash
# usage: ./run_all.sh <script.js> <outdir>   - runs every scenario, one JSON trace per scenario
S="$(cd "$(dirname "$0")" && pwd)"
script="$1"; out="$2"; mkdir -p "$out"
fail=0
while IFS= read -r s; do
  s="${s%$'\r'}"; [ -z "$s" ] && continue
  if ! node "$S/harness.mjs" "$script" "$s" > "$out/$s.json" 2> "$out/$s.err"; then
    echo "ERR $s: $(head -c 300 "$out/$s.err")"; fail=1
  fi
done < <(node "$S/harness.mjs" "$script" __list__ 2>&1 | tail -n +2)
echo "done ($(ls "$out"/*.json | wc -l | tr -d ' ') scenarios), fail=$fail"
