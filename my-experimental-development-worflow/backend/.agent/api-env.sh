#!/usr/bin/env bash
# Compatibility shim: keep old backend entrypoint while using shared scripts.

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck disable=SC1091
source "$DIR/scripts/api-env.sh"
