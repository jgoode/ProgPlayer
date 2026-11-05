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
//     ./macos-virtual-port "PracticePlayer S2 Loopback"
//
// It is only used on macOS; the Windows and Linux loopbacks come from
// loopMIDI and the ALSA sequencer respectively.
//
// The classic (non-block) CoreMIDI creation calls are used on purpose: their
// Swift import differs between SDK versions, whereas the Objective-C names
// are stable.

#import <CoreMIDI/CoreMIDI.h>
#import <Foundation/Foundation.h>

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    NSString *baseName = argc > 1 ? @(argv[1]) : @"PracticePlayer S2 Loopback";

    MIDIClientRef client = 0;
    if (MIDIClientCreate(CFSTR("PracticePlayer Spike S2"), &client) != noErr) {
      fprintf(stderr, "MIDIClientCreate failed\n");
      return 1;
    }

    MIDISourceRef source = 0;
    if (MIDISourceCreate(client, (__bridge CFStringRef)baseName, &source) != noErr) {
      fprintf(stderr, "MIDISourceCreate failed\n");
      return 1;
    }

    NSString *destinationName = [baseName stringByAppendingString:@" In"];
    MIDIDestinationRef destination = 0;
    if (MIDIDestinationCreate(client, (__bridge CFStringRef)destinationName, &destination) != noErr) {
      fprintf(stderr, "MIDIDestinationCreate failed\n");
      return 1;
    }

    // Connect the source to the destination so that what is written to the
    // source is delivered to the destination.
    if (MIDIPortConnectSource(source, destination, NULL) != noErr) {
      fprintf(stderr, "MIDIPortConnectSource failed\n");
      return 1;
    }

    printf("Created CoreMIDI loopback \"%s\" (source) -> \"%s\" (destination).\n",
           baseName.UTF8String, destinationName.UTF8String);
    fflush(stdout);

    // Keep the endpoints alive until the process is terminated.
    [[NSRunLoop currentRunLoop] run];
  }
  return 0;
}
