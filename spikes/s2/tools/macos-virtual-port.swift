// Creates a CoreMIDI virtual source/destination pair that acts as a MIDI
// loopback for the S2 measurement.
//
//   - A virtual *source* appears in other applications as an output port.
//     That is the port PracticePlayer sends to.
//   - A virtual *destination* appears as an input port. It receives whatever
//     is written to the source, so the measurement can read its own messages
//     back.
//
// The helper runs until it is killed:
//
//     swift spikes/s2/tools/macos-virtual-port.swift "PracticePlayer S2 Loopback"
//
// It is only used on macOS; the Windows and Linux loopbacks come from
// loopMIDI and the ALSA sequencer respectively.

import CoreMIDI
import Foundation

let baseName = CommandLine.arguments.count > 1
    ? CommandLine.arguments[1]
    : "PracticePlayer S2 Loopback"

var client = MIDIClientRef()
var source = MIDISourceRef()
var destination = MIDIDestinationRef()

let clientStatus = MIDIClientCreateWithBlock("PracticePlayer Spike S2" as CFString, &client) {
    _ in
}

if clientStatus != noErr {
    FileHandle.standardError.write(
        "MIDIClientCreateWithBlock failed with status \(clientStatus)\n".data(using: .utf8)!
    )
    exit(1)
}

// The source is the port other applications write to.
let sourceStatus = MIDISourceCreateWithBlock(client, "\(baseName)" as CFString, &source) {
    _ in
}

if sourceStatus != noErr {
    FileHandle.standardError.write(
        "MIDISourceCreateWithBlock failed with status \(sourceStatus)\n".data(using: .utf8)!
    )
    exit(1)
}

// The destination is the port the measurement reads from.
let destinationStatus = MIDIDestinationCreateWithBlock(
    client, "\(baseName) In" as CFString, &destination
) { _ in }

if destinationStatus != noErr {
    FileHandle.standardError.write(
        "MIDIDestinationCreateWithBlock failed with status \(destinationStatus)\n".data(using: .utf8)!
    )
    exit(1)
}

// Connect the source to the destination so that what is written to the
// source is delivered to the destination.
let connectStatus = MIDIPortConnectSource(source, destination, nil)
if connectStatus != noErr {
    FileHandle.standardError.write(
        "MIDIPortConnectSource failed with status \(connectStatus)\n".data(using: .utf8)!
    )
    exit(1)
}

print("Created CoreMIDI loopback \"\(baseName)\" (source) -> \"\(baseName) In\" (destination).")
fflush(stdout)

// Keep the endpoint alive until the process is terminated.
while true {
    Thread.sleep(forTimeInterval: 3600)
}
