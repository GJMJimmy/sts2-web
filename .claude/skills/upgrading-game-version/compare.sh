#!/bin/bash
# What a new game version changes, seen from this port, without touching any tracked file.
# Usage: bash .claude/skills/upgrading-game-version/compare.sh <old ref dir> <new gen dir>
#   <old ref dir>  the backed-up ref/ of the version the port is on (it contains decompiled/)
#   <new gen dir>  cs2ts output for the new version (sts2.ts, stubs.ts, bcl-uses.txt, warnings.txt)
# The new sources are read from ref/decompiled; the rule layer the port is on, from packages/core/src/gen.
# A section prints nothing under its title when nothing changed.
set -u
cd "$(dirname "$0")/../../.."
if [ $# -ne 2 ] || [ ! -d "$1/decompiled" ] || [ ! -f "$2/sts2.ts" ] || [ ! -d ref/decompiled ]; then
  echo "usage: bash $0 <old ref dir> <new gen dir>   (ref/decompiled must hold the new version)"; exit 2
fi
OLD="$1/decompiled" NEW=ref/decompiled GEN=packages/core/src/gen NEWGEN="$2"
HAND="packages/app/src packages/core/src/rt packages/core/src/shell.ts packages/core/src/overrides.ts"
section() { printf '\n##### %s\n' "$1"; }

section "1. save types: source of every type the save samples contain (\$t)"
for t in $(grep -rhoE '"\$t":"[^"+`]+' packages/core/test/fixtures | sort -u | sed 's/"\$t":"//'); do
  p="$(echo "$t" | sed 's/^MegaCrit\.Sts2\./MegaCrit\/sts2\//; s/\./\//g').cs"
  if [ -f "$NEW/$p" ]; then diff -u "$OLD/$p" "$NEW/$p"; else echo "GONE OR MOVED: $t"; fi
done

section "2. enums the saves hold as numbers: a moved or removed member silently changes what old saves mean"
for e in $(grep -rhoE 'JsonStringEnumConverter<[A-Za-z.]+>' "$OLD" "$NEW" | sed -E 's/.*<(.*)>/\1/; s/.*\.//' | sort -u | grep -v '^TEnum$'); do
  diff <(grep -hE "^export enum $e |stubEnum\(\"$e\"" $GEN/sts2.ts $GEN/stubs.ts) <(grep -hE "^export enum $e |stubEnum\(\"$e\"" "$NEWGEN/sts2.ts" "$NEWGEN/stubs.ts")
done

section "3. classes that are gone (a model's id is its class name)"
classes() { grep -oE '^export (abstract )?class [A-Za-z0-9_]+' "$1" | awk '{print $NF}' | sort; }
comm -23 <(classes $GEN/sts2.ts) <(classes "$NEWGEN/sts2.ts")

section "4. new transpiler warnings; runtime (BCL / Godot) members newly used or no longer used"
diff $GEN/warnings.txt "$NEWGEN/warnings.txt"
uses() { sed -E 's/^ *[0-9]+ //' "$1" | sort; }
diff <(uses $GEN/bcl-uses.txt) <(uses "$NEWGEN/bcl-uses.txt")

section "5. node stubs: what the rule layer newly calls in the untranslated layers, or no longer calls"
diff $GEN/stubs.ts "$NEWGEN/stubs.ts"

section "6. Core/Nodes files that changed, appeared or went away, with how many hand-written files name them"
nodes() { (cd "$1/MegaCrit/sts2/Core/Nodes" && find . -name '*.cs' | sort); }
{ comm -3 <(nodes "$OLD") <(nodes "$NEW") | tr -d '\t'
  comm -12 <(nodes "$OLD") <(nodes "$NEW") | while read -r f; do cmp -s "$OLD/MegaCrit/sts2/Core/Nodes/$f" "$NEW/MegaCrit/sts2/Core/Nodes/$f" || echo "$f"; done
} | sed -E 's|.*/||; s/\.cs$//' | sort -u | while read -r n; do
  c=$(grep -rlw -- "$n" $HAND | wc -l | tr -d ' '); [ "$c" -gt 0 ] && echo "$n  $c"
done

section "7. originals that overrides.ts, shell.ts and rt re-implement or patch, where the original changed"
{ grep -oE '(^|[^A-Za-z0-9_$.])g\.[A-Z][A-Za-z0-9_]+' packages/core/src/overrides.ts | sed -E 's/.*g\.//'
  grep -ohE 'MegaCrit\.[A-Za-z0-9_.]+' packages/core/src/overrides.ts packages/core/src/shell.ts packages/core/src/rt/*.ts | sed -E 's/.*\.//'
  grep -oE '(^|[^A-Za-z0-9_])N[A-Z][A-Za-z]+' packages/core/src/shell.ts | sed -E 's/^[^N]*//'
} | sort -u | while read -r n; do
  for f in $({ (cd "$OLD" && find . -name "$n.cs"); (cd "$NEW" && find . -name "$n.cs"); } | sort -u); do
    cmp -s "$OLD/$f" "$NEW/$f" || echo "$f"
  done
done
diff -rq "$OLD/MegaCrit/sts2/Core/Random" "$NEW/MegaCrit/sts2/Core/Random"
exit 0
