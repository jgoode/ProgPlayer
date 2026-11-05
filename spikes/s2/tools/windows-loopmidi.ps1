#!/usr/bin/env pwsh
#
# Creates the Windows MIDI loopback used by the S2 measurement.
#
# loopMIDI stores its virtual ports in the registry under
#   HKCU\Software\Tobias Erichsen\loopMIDI\Ports
# where each value name is a port name and the value is a REG_DWORD of 1.
# Writing the ports before starting loopMIDI makes it create them without
# any GUI interaction, which is what a CI runner needs.
#
# A loopMIDI port is bidirectional: it appears both as an output and as an
# input to other applications, so a single port is enough to send to and to
# capture from.
#
# Usage:
#   powershell -File spikes/s2/tools/windows-loopmidi.ps1 -Ports "S2 Loopback"

param(
  [string[]]$Ports = @('PracticePlayer S2 Loopback'),
  [string]$LoopMidiPath = 'C:\Program Files (x86)\Tobias Erichsen\loopMIDI\loopMIDI.exe'
)

$ErrorActionPreference = 'Stop'

$portsKey = 'HKCU:\Software\Tobias Erichsen\loopMIDI\Ports'
if (-not (Test-Path $portsKey)) {
  New-Item -Path $portsKey -Force | Out-Null
}

foreach ($port in $Ports) {
  New-ItemProperty -Path $portsKey -Name $port -Value 1 -PropertyType DWord -Force | Out-Null
  Write-Output "Configured loopMIDI port: $port"
}

if (-not (Test-Path $LoopMidiPath)) {
  Write-Error "loopMIDI was not found at '$LoopMidiPath'."
  exit 1
}

$running = Get-Process -Name 'loopMIDI' -ErrorAction SilentlyContinue
if ($running) {
  Write-Output 'loopMIDI is already running; restarting it to apply the ports.'
  $running | Stop-Process -Force
  Start-Sleep -Seconds 2
}

Start-Process -FilePath $LoopMidiPath
Start-Sleep -Seconds 5

Write-Output 'loopMIDI started.'
Get-ChildItem $portsKey | ForEach-Object { Write-Output "  port: $($_.PSChildName)" }
