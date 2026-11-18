#!/usr/bin/env sh
# Regenerates the expected hledger outputs used by the golden tests.
# Run after editing any *.journal fixture. Requires hledger 1.52.1 on PATH.
set -eu
cd "$(dirname "$0")"
hledger --version | grep -q '^hledger 1\.52\.' || { echo "need hledger 1.52.x"; exit 1; }
for j in recipes; do
  hledger -f "$j.journal" check --strict ordereddates
  hledger -f "$j.journal" print -O json > "$j.print.json"
  hledger -f "$j.journal" bal -O json > "$j.bal.json"
  hledger -f "$j.journal" bal -X CHF --infer-market-prices -O json > "$j.bal-chf.json"
  # keep only file names in source positions so the output is machine independent
  for f in "$j.print.json" "$j.bal.json" "$j.bal-chf.json"; do
    sed -E 's#"sourceName": "[^"]*[\\/]([^"\\/]+)"#"sourceName": "\1"#; s/\r$//' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  done
done
echo "fixtures regenerated"
