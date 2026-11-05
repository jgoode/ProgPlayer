// Creates a CoreMIDI virtual source/destination pair that acts as a MIDI
// loopback for the S2 measurement.
//
// CoreMIDI's naming is the opposite of what an application sees:
//
//   - A virtual *destination* (MIDIDestinationCreate) appears in other
//     applications as an **output** port — they write to it. That is the
//     port the measurement sends to.
//   - A virtual *source* (MIDISourceCreate) appears in other applications as
//     an **input** port — they read from it. That is the port the
//     measurement captures from.
//
// The two are joined by forwarding every packet the destination receives
// into the source with MIDIReceived(), so what the measurement writes comes
// back to it.
//
// The helper runs until it is killed:
//
//     ./macos-virtual-port "PracticePlayer S2 Loopback"
//
// It is only used on macOS; the Windows loopback comes from loopMIDI.
//
// Written in Objective-C on purpose: the Swift importer for these CoreMIDI
// functions differs between SDK versions (`MIDISourceRef` versus
// `MIDIEndpointRef`, the block-based variants), so the Objective-C names
// are used for stability across macOS versions.

#import <CoreMIDI/CoreMIDI.h>
#import <Foundation/Foundation.h>

// The virtual source the destination's packets are forwarded into.
static MIDIEndpointRef gSource = 0;

// Called by CoreMIDI when another client writes to our virtual destination.
static void ReadProc(const MIDIPacketList *packetList, void *refCon,
                     void *srcConnRefCon) {
  (void)refCon;
  (void)srcConnRefCon;
  if (gSource != 0 && packetList != NULL) {
    MIDIReceived(gSource, packetList);
  }
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    NSString *baseName = argc > 1 ? @(argv[1]) : @"PracticePlayer S2 Loopback";

    MIDIClientRef client = 0;
    if (MIDIClientCreate(CFSTR("PracticePlayer Spike S2"), NULL, NULL, &client) != noErr) {
      fprintf(stderr, "MIDIClientCreate failed\n");
      return 1;
    }

    // The source is what the measurement reads from; it appears in other
    // applications as an input port.
    NSString *sourceName = [baseName stringByAppendingString:@" In"];
    if (MIDISourceCreate(client, (__bridge CFStringRef)sourceName, &gSource) != noErr) {
      fprintf(stderr, "MIDISourceCreate failed\n");
      return 1;
    }

    // The destination is what the measurement writes to; it appears in other
    // applications as an output port.
    MIDIEndpointRef destination = 0;
    if (MIDIDestinationCreate(client, (__bridge CFStringRef)baseName, ReadProc, NULL,
                              &destination) != noErr) {
      fprintf(stderr, "MIDIDestinationCreate failed\n");
      return 1;
    }

    printf("Created CoreMIDI loopback: write to \"%s\" (destination), read from \"%s\" (source).\n",
           baseName.UTF8String, sourceName.UTF8String);
    fflush(stdout);

    // Keep the endpoints alive until the process is terminated.
    [[NSRunLoop currentRunLoop] run];
  }
  return 0;
}
