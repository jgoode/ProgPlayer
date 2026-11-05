#!/usr/bin/env bash
#
# Builds and runs the CoreMIDI virtual loopback used by the S2 measurement
# on macOS.
#
# Usage:
#   spikes/s2/tools/macos-virtual-port.sh "PracticePlayer S2 Loopback" &
#
# The helper creates a virtual *source* (an output port that other
# applications write to) and a virtual *destination* (an input port), and
# connects the source to the destination so that everything written to the
# source is delivered to the destination.

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
