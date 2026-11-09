const LETTER_SEMITONES = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11
};
const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const LETTER_INDEX = {
  C: 0,
  D: 1,
  E: 2,
  F: 3,
  G: 4,
  A: 5,
  B: 6
};
function modulo12(value) {
  return (value % 12 + 12) % 12;
}
function signedModulo12(value) {
  const normalised = modulo12(value);
  return normalised > 6 ? normalised - 12 : normalised;
}
function pitchClassNumber(pitch) {
  return modulo12(LETTER_SEMITONES[pitch.letter] + pitch.alteration);
}
function stepLetter(letter, count) {
  const index = (LETTER_INDEX[letter] + count + 7 * 7) % 7;
  return LETTERS[index];
}
function isSupportedAlteration(alteration) {
  return alteration >= -2 && alteration <= 2;
}
function formatAlteration(alteration) {
  if (alteration === 0) {
    return "";
  }
  const symbol = alteration > 0 ? "♯" : "♭";
  return symbol.repeat(Math.abs(alteration));
}
function formatPitchClass(pitch) {
  return `${pitch.letter}${formatAlteration(pitch.alteration)}`;
}
function spellDiatonicTone(root, letterSteps, semitonesAboveRoot) {
  const letter = stepLetter(root.letter, letterSteps);
  const target = modulo12(pitchClassNumber(root) + semitonesAboveRoot);
  const alteration = signedModulo12(target - LETTER_SEMITONES[letter]);
  if (!isSupportedAlteration(alteration)) {
    throw new RangeError(
      `Tone ${letterSteps + 1} of ${root.letter}${root.alteration} needs an unsupported accidental`
    );
  }
  return { letter, alteration };
}
function closestSupportedSpelling(target, preferredLetter) {
  const candidates = spellingsForPitchClass(target);
  if (preferredLetter !== void 0) {
    const preferred = candidates.find((candidate) => candidate.letter === preferredLetter);
    if (preferred !== void 0) {
      return { pitch: preferred, exact: true };
    }
  }
  let best = null;
  for (const candidate of candidates) {
    if (best === null) {
      best = candidate;
      continue;
    }
    const candidateDistance = Math.abs(candidate.alteration);
    const bestDistance = Math.abs(best.alteration);
    if (candidateDistance < bestDistance) {
      best = candidate;
    }
  }
  if (best === null) {
    throw new RangeError(`No supported spelling for pitch class ${target}`);
  }
  return { pitch: best, exact: false };
}
function spellingsForPitchClass(target) {
  const result = [];
  for (const letter of LETTERS) {
    const alteration = signedModulo12(target - LETTER_SEMITONES[letter]);
    if (isSupportedAlteration(alteration)) {
      result.push({ letter, alteration });
    }
  }
  return result;
}
const CHORD_FORMULAS = {
  "": [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 7 }
  ],
  m: [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 3 },
    { degree: 5, semitones: 7 }
  ],
  dim: [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 3 },
    { degree: 5, semitones: 6 }
  ],
  aug: [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 8 }
  ],
  maj7: [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 11 }
  ],
  m7: [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 3 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 10 }
  ],
  "7": [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 10 }
  ],
  "m7♭5": [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 3 },
    { degree: 5, semitones: 6 },
    { degree: 7, semitones: 10 }
  ],
  dim7: [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 3 },
    { degree: 5, semitones: 6 },
    { degree: 7, semitones: 9 }
  ],
  mMaj7: [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 3 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 11 }
  ],
  "6": [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 7 },
    { degree: 6, semitones: 9 }
  ],
  m6: [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 3 },
    { degree: 5, semitones: 7 },
    { degree: 6, semitones: 9 }
  ],
  add9: [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 7 },
    { degree: 9, semitones: 14 }
  ],
  madd9: [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 3 },
    { degree: 5, semitones: 7 },
    { degree: 9, semitones: 14 }
  ],
  "9": [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 10 },
    { degree: 9, semitones: 14 }
  ],
  maj9: [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 11 },
    { degree: 9, semitones: 14 }
  ],
  m9: [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 3 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 10 },
    { degree: 9, semitones: 14 }
  ],
  "7♭9": [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 10 },
    { degree: 9, semitones: 13 }
  ],
  "7♯9": [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 10 },
    { degree: 9, semitones: 15 }
  ],
  "7♭5": [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 6 },
    { degree: 7, semitones: 10 }
  ],
  "7♯5": [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 8 },
    { degree: 7, semitones: 10 }
  ],
  "7♯11": [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 10 },
    { degree: 11, semitones: 18 }
  ],
  "7♭13": [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 10 },
    { degree: 13, semitones: 20 }
  ],
  "11": [
    { degree: 1, semitones: 0 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 10 },
    { degree: 9, semitones: 14 },
    { degree: 11, semitones: 17 }
  ],
  m11: [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 3 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 10 },
    { degree: 9, semitones: 14 },
    { degree: 11, semitones: 17 }
  ],
  maj11: [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 11 },
    { degree: 9, semitones: 14 },
    { degree: 11, semitones: 17 }
  ],
  "13": [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 10 },
    { degree: 9, semitones: 14 },
    { degree: 13, semitones: 21 }
  ],
  maj13: [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 11 },
    { degree: 9, semitones: 14 },
    { degree: 13, semitones: 21 }
  ],
  m13: [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 3 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 10 },
    { degree: 9, semitones: 14 },
    { degree: 13, semitones: 21 }
  ],
  sus2: [
    { degree: 1, semitones: 0 },
    { degree: 2, semitones: 2 },
    { degree: 5, semitones: 7 }
  ],
  sus4: [
    { degree: 1, semitones: 0 },
    { degree: 4, semitones: 5 },
    { degree: 5, semitones: 7 }
  ],
  "7sus4": [
    { degree: 1, semitones: 0 },
    { degree: 4, semitones: 5 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 10 }
  ],
  "7sus2": [
    { degree: 1, semitones: 0 },
    { degree: 2, semitones: 2 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 10 }
  ],
  mMaj9: [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 3 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 11 },
    { degree: 9, semitones: 14 }
  ],
  mMaj13: [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 3 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 11 },
    { degree: 9, semitones: 14 },
    { degree: 13, semitones: 21 }
  ],
  "maj7♯11": [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 11 },
    { degree: 11, semitones: 18 }
  ],
  "9♯11": [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 10 },
    { degree: 9, semitones: 14 },
    { degree: 11, semitones: 18 }
  ],
  "13♯11": [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 10 },
    { degree: 9, semitones: 14 },
    { degree: 11, semitones: 18 },
    { degree: 13, semitones: 21 }
  ],
  "7♭9♯5": [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 8 },
    { degree: 7, semitones: 10 },
    { degree: 9, semitones: 13 }
  ],
  "7♯9♯5": [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 8 },
    { degree: 7, semitones: 10 },
    { degree: 9, semitones: 15 }
  ],
  "7♭9♭13": [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 10 },
    { degree: 9, semitones: 13 },
    { degree: 13, semitones: 20 }
  ],
  "7♯9♭13": [
    { degree: 1, semitones: 0 },
    { degree: 3, semitones: 4 },
    { degree: 5, semitones: 7 },
    { degree: 7, semitones: 10 },
    { degree: 9, semitones: 15 },
    { degree: 13, semitones: 20 }
  ]
};
const DEGREE_POSITION = {
  1: 0,
  2: 1,
  3: 2,
  4: 3,
  5: 4,
  6: 5,
  7: 6,
  9: 1,
  11: 3,
  13: 5
};
function hasMajorThird(quality) {
  const third = CHORD_FORMULAS[quality].find((entry) => entry.degree === 3);
  return third?.semitones === 4;
}
function buildChord(root, quality) {
  const notes = CHORD_FORMULAS[quality].map((entry) => {
    const letterSteps = DEGREE_POSITION[entry.degree];
    if (letterSteps === void 0) {
      throw new RangeError(`Unsupported chord degree: ${entry.degree}`);
    }
    try {
      return spellDiatonicTone(root, letterSteps, entry.semitones);
    } catch {
      const target = (pitchClassNumber(root) + entry.semitones) % 12;
      const preferredLetter = stepLetter(root.letter, letterSteps);
      return closestSupportedSpelling(target, preferredLetter).pitch;
    }
  });
  return { root, quality, notes };
}
function formatChordName(chord) {
  const symbol = chord.root.alteration > 0 ? "♯" : "♭";
  const accidental = chord.root.alteration === 0 ? "" : symbol.repeat(Math.abs(chord.root.alteration));
  return `${chord.root.letter}${accidental}${chord.quality}`;
}
const SCALE_INTERVALS = {
  major: [0, 2, 4, 5, 7, 9, 11],
  naturalMinor: [0, 2, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  melodicMinor: [0, 2, 3, 5, 7, 9, 11],
  ionian: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10]
};
const CONSECUTIVE_DEGREES = [
  { letterSteps: 0 },
  { letterSteps: 1 },
  { letterSteps: 2 },
  { letterSteps: 3 },
  { letterSteps: 4 },
  { letterSteps: 5 },
  { letterSteps: 6 }
];
const HINT_SCALE_INTERVALS = {
  ...SCALE_INTERVALS,
  wholeTone: [0, 2, 4, 6, 8, 10],
  wholeHalfDiminished: [0, 2, 3, 5, 6, 8, 9, 11],
  halfWholeDiminished: [0, 1, 3, 4, 6, 7, 9, 10],
  lydianDominant: [0, 2, 4, 6, 7, 9, 10],
  dominantFlatSix: [0, 2, 4, 5, 7, 8, 10]
};
const HINT_SCALE_DEGREES = {
  wholeTone: [
    { letterSteps: 0 },
    { letterSteps: 1 },
    { letterSteps: 2 },
    { letterSteps: 3 },
    { letterSteps: 4 },
    { letterSteps: 5 }
  ],
  wholeHalfDiminished: [
    { letterSteps: 0 },
    { letterSteps: 1 },
    { letterSteps: 2 },
    { letterSteps: 3 },
    { letterSteps: 4 },
    { letterSteps: 5 },
    { letterSteps: 5 },
    { letterSteps: 6 }
  ],
  halfWholeDiminished: [
    { letterSteps: 0 },
    { letterSteps: 1 },
    { letterSteps: 2 },
    { letterSteps: 2 },
    { letterSteps: 4 },
    { letterSteps: 4 },
    { letterSteps: 5 },
    { letterSteps: 6 }
  ],
  lydianDominant: [
    { letterSteps: 0 },
    { letterSteps: 1 },
    { letterSteps: 2 },
    { letterSteps: 3 },
    { letterSteps: 4 },
    { letterSteps: 5 },
    { letterSteps: 6 }
  ],
  dominantFlatSix: [
    { letterSteps: 0 },
    { letterSteps: 1 },
    { letterSteps: 2 },
    { letterSteps: 3 },
    { letterSteps: 4 },
    { letterSteps: 5 },
    { letterSteps: 6 }
  ]
};
function buildSpelledScale(tonic2, intervals, degrees = CONSECUTIVE_DEGREES) {
  return intervals.map((interval, index) => {
    const position = degrees[index];
    if (position === void 0) {
      throw new RangeError(`No degree position for scale degree ${index + 1}`);
    }
    const note = spellDiatonicTone(tonic2, position.letterSteps, interval);
    if (!isSupportedAlteration(note.alteration)) {
      throw new RangeError(
        `Scale degree ${index + 1} of ${tonic2.letter}${tonic2.alteration} needs an unsupported accidental`
      );
    }
    return note;
  });
}
function generateScale(tonic2, type) {
  const intervals = SCALE_INTERVALS[type];
  return {
    type,
    tonic: tonic2,
    intervals,
    notes: buildSpelledScale(tonic2, intervals)
  };
}
function generateHintScale(tonic2, type) {
  const intervals = HINT_SCALE_INTERVALS[type];
  return {
    type,
    notes: buildSpelledScale(tonic2, intervals, HINT_SCALE_DEGREES[type])
  };
}
const MAJOR_SCALE_INTERVALS = [0, 2, 4, 5, 7, 9, 11];
function resolveDegreeRoot(tonic2, degree) {
  if (!Number.isInteger(degree.degree) || degree.degree < 1 || degree.degree > 7) {
    throw new RangeError(`Degree must be an integer from 1 to 7: ${degree.degree}`);
  }
  const alteration = degree.alteration ?? 0;
  if (alteration < -2 || alteration > 2) {
    throw new RangeError(`Degree alteration must be within -2..2: ${alteration}`);
  }
  const naturalInterval = MAJOR_SCALE_INTERVALS[degree.degree - 1];
  return spellDiatonicTone(tonic2, degree.degree - 1, naturalInterval + alteration);
}
function resolveDegreeChord(tonic2, degree) {
  let root;
  let enharmonic = false;
  try {
    root = resolveDegreeRoot(tonic2, degree);
  } catch {
    const naturalInterval = MAJOR_SCALE_INTERVALS[degree.degree - 1];
    const alteration = degree.alteration ?? 0;
    const target = pitchClassNumber(tonic2) + naturalInterval + alteration;
    const preferredLetter = stepLetter(tonic2.letter, degree.degree - 1);
    const closest = closestSupportedSpelling(target, preferredLetter);
    root = closest.pitch;
    enharmonic = !closest.exact;
  }
  return { degree, chord: buildChord(root, degree.quality), enharmonic };
}
function resolveProgression(tonic2, degrees) {
  return degrees.map((degree) => resolveDegreeChord(tonic2, degree));
}
const STANDARD_TUNING = [40, 45, 50, 55, 59, 64];
function fretboardPositions(pitchClasses, options = {}) {
  const tuning = options.tuning ?? STANDARD_TUNING;
  const minFret = options.frets?.min ?? 0;
  const maxFret = options.frets?.max ?? 15;
  if (minFret < 0 || maxFret < minFret) {
    throw new RangeError(`Invalid fret range: ${minFret}..${maxFret}`);
  }
  const targets = new Set(
    pitchClasses.map(
      (pitch) => typeof pitch === "number" ? modulo12(pitch) : pitchClassNumber(pitch)
    )
  );
  const positions = [];
  tuning.forEach((openNote, stringIndex) => {
    for (let fret = minFret; fret <= maxFret; fret += 1) {
      const midiNote = openNote + fret;
      const pitchClass = modulo12(midiNote);
      if (targets.has(pitchClass)) {
        positions.push({
          stringIndex,
          openNote,
          fret,
          midiNote,
          pitchClass
        });
      }
    }
  });
  return positions;
}
function chordFretboardPositions(chord, options = {}) {
  return fretboardPositions(chord.notes, options);
}
const m = "naturalMinor";
const dim = "wholeHalfDiminished";
const aug = "wholeTone";
const maj7 = "ionian";
const m7 = "naturalMinor";
const dim7 = "wholeHalfDiminished";
const mMaj7 = "harmonicMinor";
const m6 = "melodicMinor";
const add9 = "major";
const madd9 = "naturalMinor";
const maj9 = "ionian";
const m9 = "naturalMinor";
const m11 = "naturalMinor";
const maj11 = "major";
const maj13 = "major";
const m13 = "dorian";
const sus2 = "major";
const sus4 = "major";
const mMaj9 = "harmonicMinor";
const mMaj13 = "melodicMinor";
const hintTable = {
  "6": "major",
  "7": "mixolydian",
  "9": "mixolydian",
  "11": "naturalMinor",
  "13": "mixolydian",
  "": "major",
  m,
  dim,
  aug,
  maj7,
  m7,
  "m7♭5": "locrian",
  dim7,
  mMaj7,
  m6,
  add9,
  madd9,
  maj9,
  m9,
  "7♭9": "halfWholeDiminished",
  "7♯9": "halfWholeDiminished",
  "7♭5": "wholeTone",
  "7♯5": "wholeTone",
  "7♯11": "halfWholeDiminished",
  "7♭13": "dominantFlatSix",
  m11,
  maj11,
  maj13,
  m13,
  sus2,
  sus4,
  "7sus4": "mixolydian",
  "7sus2": "mixolydian",
  mMaj9,
  mMaj13,
  "maj7♯11": "lydian",
  "9♯11": "halfWholeDiminished",
  "13♯11": "halfWholeDiminished",
  "7♭9♯5": "halfWholeDiminished",
  "7♯9♯5": "halfWholeDiminished",
  "7♭9♭13": "halfWholeDiminished",
  "7♯9♭13": "halfWholeDiminished"
};
const CHORD_SCALE_HINTS = hintTable;
function suggestScaleForChord(chord) {
  return CHORD_SCALE_HINTS[chord.quality];
}
function getChordScaleHints(chord, tonic2, scaleType) {
  const suggestionType = suggestScaleForChord(chord);
  return {
    inKeyScale: generateScale(tonic2, scaleType),
    suggestedScale: generateHintScale(chord.root, suggestionType)
  };
}
const DEFAULT_VOICING_RULES = {
  chordLow: 40,
  chordHigh: 91,
  bassLow: 28,
  bassHigh: 39,
  chordCentre: 48,
  bassCentre: 36,
  closeSpan: 24
};
const VOICING_RULES = [
  {
    id: "drop-fifth-for-ninth-or-higher",
    minimumExtensionDegree: 9,
    removesDegree: 5
  },
  {
    id: "drop-eleventh-over-major-third",
    minimumExtensionDegree: 11,
    removesDegree: 11,
    requiresMajorThird: true,
    requiresUnaltered: true
  }
];
function formulaEntry(quality, degree) {
  return CHORD_FORMULAS[quality].find((entry) => entry.degree === degree);
}
function retainedFormulaDegrees(quality) {
  const formula = CHORD_FORMULAS[quality];
  const removed = /* @__PURE__ */ new Set();
  for (const rule of VOICING_RULES) {
    if (rule.removesDegree === void 0) {
      continue;
    }
    const removedEntry = formulaEntry(quality, rule.removesDegree);
    if (removedEntry === void 0) {
      continue;
    }
    const hasTrigger = formula.some((entry) => entry.degree >= (rule.minimumExtensionDegree ?? 0));
    if (!hasTrigger) {
      continue;
    }
    if (rule.requiresMajorThird === true && !hasMajorThird(quality)) {
      continue;
    }
    if (rule.requiresUnaltered === true) {
      const naturalSemitones = rule.removesDegree === 11 ? 17 : void 0;
      if (naturalSemitones !== void 0 && removedEntry.semitones !== naturalSemitones) {
        continue;
      }
    }
    removed.add(rule.removesDegree);
  }
  return formula.filter((entry) => !removed.has(entry.degree)).map((entry) => entry.degree);
}
function voiceLeadingCost(previous, candidate) {
  if (previous.length === 0 || candidate.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  let cost = 0;
  for (const note of previous) {
    let nearest = Number.POSITIVE_INFINITY;
    for (const other of candidate) {
      nearest = Math.min(nearest, Math.abs(note - other));
    }
    cost += nearest;
  }
  for (const note of candidate) {
    let nearest = Number.POSITIVE_INFINITY;
    for (const other of previous) {
      nearest = Math.min(nearest, Math.abs(note - other));
    }
    cost += nearest;
  }
  return cost;
}
function closePositionCandidates(chord, rules = DEFAULT_VOICING_RULES) {
  const degrees = retainedFormulaDegrees(chord.quality);
  const formula = CHORD_FORMULAS[chord.quality];
  const pitchClasses = degrees.map((degree) => {
    const index = formula.findIndex((entry) => entry.degree === degree);
    const note = chord.notes[index];
    if (note === void 0) {
      throw new RangeError(`Missing chord tone for degree ${degree}`);
    }
    return pitchClassNumber(note);
  });
  const candidates = [];
  for (let rotation = 0; rotation < pitchClasses.length; rotation += 1) {
    const rotated = [...pitchClasses.slice(rotation), ...pitchClasses.slice(0, rotation)];
    const offsets = [0];
    for (let index = 1; index < rotated.length; index += 1) {
      const previous = rotated[index - 1];
      const current = rotated[index];
      let offset = current - previous;
      while (offset <= 0) {
        offset += 12;
      }
      offsets.push(offsets[index - 1] + offset);
    }
    const span = offsets[offsets.length - 1] - offsets[0];
    if (span > rules.closeSpan) {
      continue;
    }
    const firstPitchClass = rotated[0];
    for (let first = rules.chordLow; first + span <= rules.chordHigh; first += 1) {
      if ((first % 12 + 12) % 12 !== firstPitchClass) {
        continue;
      }
      candidates.push({
        notes: offsets.map((offset) => first + offset),
        cost: 0,
        lowest: first
      });
    }
  }
  return candidates;
}
function selectVoicing(chord, previous = [], rules = DEFAULT_VOICING_RULES, minimumNote = rules.chordLow) {
  const allCandidates = closePositionCandidates(chord, rules);
  if (allCandidates.length === 0) {
    throw new RangeError(`No close-position voicing fits the register for ${chord.quality}`);
  }
  const candidates = allCandidates.filter((candidate) => candidate.lowest >= minimumNote);
  if (candidates.length === 0) {
    throw new RangeError(
      `No close-position voicing fits above MIDI ${minimumNote} for ${chord.quality}`
    );
  }
  let best = null;
  let bestSecondary = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const rootIndex = candidate.notes.findIndex(
      (note) => (note % 12 + 12) % 12 === pitchClassNumber(chord.root)
    );
    const rootNote = candidate.notes[rootIndex < 0 ? 0 : rootIndex];
    const isFirst = previous.length === 0;
    const cost = isFirst ? Math.abs(rootNote - rules.chordCentre) : voiceLeadingCost(previous, candidate.notes);
    const secondary = isFirst ? rootIndex === 0 ? 0 : 1 : candidate.lowest;
    const scored = { ...candidate, cost };
    if (best === null || scored.cost < best.cost || scored.cost === best.cost && secondary < bestSecondary) {
      best = scored;
      bestSecondary = secondary;
    }
  }
  return best.notes;
}
function selectBassNote(chord, rules = DEFAULT_VOICING_RULES) {
  const rootPitchClass = pitchClassNumber(chord.root);
  let best = Number.NaN;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let note = rules.bassLow; note <= rules.bassHigh; note += 1) {
    if ((note % 12 + 12) % 12 !== rootPitchClass) {
      continue;
    }
    const distance = Math.abs(note - rules.bassCentre);
    if (distance < bestDistance) {
      best = note;
      bestDistance = distance;
    }
  }
  if (Number.isNaN(best)) {
    throw new RangeError(`No bass note fits the register for root ${chord.root.letter}`);
  }
  return best;
}
function voiceChord(chord, previous = [], rules = DEFAULT_VOICING_RULES) {
  const bass = selectBassNote(chord, rules);
  const notes = selectVoicing(chord, previous, rules, bass + 1);
  return { notes, bass };
}
function voiceProgression(chords, rules = DEFAULT_VOICING_RULES) {
  const voicings2 = [];
  let previous = [];
  for (const chord of chords) {
    const voicing = voiceChord(chord, previous, rules);
    voicings2.push(voicing);
    previous = voicing.notes;
  }
  return voicings2;
}
const tonic = { letter: "C", alteration: 0 };
const scale = generateScale(tonic, "major");
console.log("C major:", scale.notes.map(formatPitchClass).join(" "));
const resolved = resolveProgression(tonic, [
  { degree: 2, quality: "m7" },
  { degree: 5, quality: "7" },
  { degree: 1, quality: "maj7" }
]);
console.log("ii-V-I:", resolved.map((item) => formatChordName(item.chord)).join(" "));
const voicings = voiceProgression(resolved.map((item) => item.chord));
console.log(
  "voicings:",
  JSON.stringify(voicings.map((voicing) => ({ notes: voicing.notes, bass: voicing.bass })))
);
const hints = getChordScaleHints(resolved[0].chord, tonic, "major");
console.log("hint:", hints.inKeyScale.type, "->", hints.suggestedScale.type);
console.log("fretboard Cmaj7:", chordFretboardPositions(resolved[2].chord).length, "positions");
