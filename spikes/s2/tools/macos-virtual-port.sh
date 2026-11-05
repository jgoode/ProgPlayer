#!/usr/bin/env bash
#
# Builds and runs the CoreMIDI virtual loopback used by the S2 measurement
# on macOS.
#
# Usage:
#   spikes/s2/tools/macos-virtual-port.sh "PracticePlayer S2 Loopback" &
#
# The helper creates a virtual *destination* (which appears in other
# applications as an output port that they write to) and a virtual *source*
# (which appears as an input port that they read from), and forwards every
# packet the destination receives into the source.

set -euo pipefail

BASE_NAME="${1:-PracticePlayer S2 Loopback}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_FILE="${SCRIPT_DIR}/macos-virtual-port.m"
BINARY="${TMPDIR:-/tmp}/practiceplayer-s2-virtual-port"

if [ ! -x "${BINARY}" ] || [ "${SOURCE_FILE}" -nt "${BINARY}" ]; then
  echo "Building the CoreMIDI loopback helper..."
  clang -fobjc-arc -framework CoreMIDI -framework Foundation \
    -o "${BINARY}" "${SOURCE_FILE}"
fi

exec "${BINARY}" "${BASE_NAME}"
