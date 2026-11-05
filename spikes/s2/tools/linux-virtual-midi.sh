#!/usr/bin/env bash
#
# Prepares the Linux ALSA-sequencer MIDI loopback used by the S2
# measurement.
#
# `snd-virmidi` provides a "Midi Through" client with two sequencer ports:
# "Midi Through Port-0" (an input) and "Midi Through Port-1" (an output).
# The driver connects the two internally, so whatever is written to the
# output port is delivered to the input port — the loopback the measurement
# needs, with no extra routing.
#
# Run as root on a machine with the ALSA sequencer loaded:
#
#     sudo modprobe snd-seq
#     sudo modprobe snd-virmidi
#     sudo spikes/s2/tools/linux-virtual-midi.sh start
#     ... run the measurement ...
#     sudo modprobe -r snd-virmidi

set -euo pipefail

ALSA_CLIENT="Midi Through"

case "${1:-start}" in
  start)
    modprobe snd-seq || true
    modprobe snd-virmidi || true

    if ! command -v aconnect >/dev/null 2>&1; then
      echo "alsa-utils (aconnect) is required to list the sequencer clients." >&2
      exit 1
    fi

    if [ ! -e /dev/snd/seq ]; then
      echo "The ALSA sequencer device /dev/snd/seq is missing." >&2
      echo "This kernel has no ALSA sequencer (Azure kernels do not ship snd-seq)." >&2
      exit 1
    fi

    echo "ALSA sequencer clients:"
    aconnect -l

    # The "Midi Through" client exposes "<client> Port-0" (input) and
    # "<client> Port-1" (output).
    output_port="$(aconnect -l | grep -i "${ALSA_CLIENT}" | grep -o "[^ ]*Port-1" | head -n 1 || true)"
    input_port="$(aconnect -l | grep -i "${ALSA_CLIENT}" | grep -o "[^ ]*Port-0" | head -n 1 || true)"

    if [[ -z "${output_port}" || -z "${input_port}" ]]; then
      echo "Could not find the '${ALSA_CLIENT}' client ports." >&2
      exit 1
    fi

    echo "Loopback output port: ${output_port}"
    echo "Loopback input port:  ${input_port}"
    echo "The snd-virmidi client loops the output port into the input port itself;"
    echo "no extra subscription is needed (adding one would duplicate every message)."
    ;;
  stop)
    echo "The snd-virmidi client disappears when the module is unloaded:"
    echo "    sudo modprobe -r snd-virmidi"
    ;;
  *)
    echo "Usage: $0 [start|stop]" >&2
    exit 2
    ;;
esac
