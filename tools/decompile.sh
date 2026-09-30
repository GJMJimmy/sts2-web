#!/bin/bash
# Decompile sts2.dll to C# with ILSpy. Needs: brew install dotnet; dotnet tool install --global ilspycmd
set -e
cd "$(dirname "$0")/.."
# dotnet: either `brew install dotnet` or the official script:
#   curl -sSL https://dot.net/v1/dotnet-install.sh | bash -s -- --channel 9.0 --install-dir ~/.dotnet
export DOTNET_ROOT="${DOTNET_ROOT:-$HOME/.dotnet}" PATH="$HOME/.dotnet:$HOME/.dotnet/tools:$PATH" DOTNET_ROLL_FORWARD=Major
REFS="/Applications/SlayTheSpire2.app/Contents/Game/SlayTheSpire2.app/Contents/Resources/data_sts2_macos_arm64"
mkdir -p ref/decompiled
ilspycmd ref/dotnet/sts2.dll -p -o ref/decompiled -r "$REFS" --nested-directories --disable-updatecheck
# SmartFormat (localization formatter) is transpiled from source too: cs2ts expects it next to ref/decompiled
mkdir -p ref/smartformat
ilspycmd "$REFS/SmartFormat.dll" -p -o ref/smartformat -r "$REFS" --nested-directories --disable-updatecheck
echo "cs files: $(find ref/decompiled -name '*.cs' | wc -l) game, $(find ref/smartformat -name '*.cs' | wc -l) SmartFormat"
