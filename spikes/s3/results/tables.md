#### 44100 Hz

| Candidate | kbps | Node median (s) | Node ×rt | Electron median (s) | Electron ×rt | MP3 bytes | SNR Node / Electron (dB) | Align lag |
|---|---|---|---|---|---|---|---|---|
| `rusty_mp3 (wasm)` | 128 | 3.96 | 75.8 | 3.85 | 77.9 | 4 790 079 | 35.26 / 35.26 | 0 |
| `rusty_mp3 (wasm)` | 192 | 5.33 | 56.2 | 5.36 | 55.9 | 7 190 862 | 39.67 / 39.67 | 0 |
| `wasm-media-encoders` | 128 | 2.79 | 107.4 | 3.36 | 89.3 | 4 800 679 | 25.90 / 25.90 | 2210 |
| `wasm-media-encoders` | 192 | 2.94 | 102.0 | 3.00 | 100.0 | 7 201 018 | 30.40 / 30.40 | 2210 |
| `@mediabunny/mp3-encoder` | 128 | — | — | 3.28 | 91.4 | 4 800 887 | — / 25.91 | 0 |
| `@mediabunny/mp3-encoder` | 192 | — | — | 3.90 | 77.0 | 7 201 226 | — / 30.40 | 0 |
| `@breezystack/lamejs` | 128 | 9.21 | 32.6 | 8.92 | 33.6 | 4 800 679 | 18.91 / 18.91 | 2210 |
| `@breezystack/lamejs` | 192 | 9.30 | 32.3 | 8.98 | 33.4 | 7 201 018 | 29.53 / 29.53 | 2210 |

#### 48000 Hz

| Candidate | kbps | Node median (s) | Node ×rt | Electron median (s) | Electron ×rt | MP3 bytes | SNR Node / Electron (dB) | Align lag |
|---|---|---|---|---|---|---|---|---|
| `rusty_mp3 (wasm)` | 128 | 4.18 | 71.8 | 4.04 | 74.3 | 4 800 768 | 35.02 / 35.02 | 0 |
| `rusty_mp3 (wasm)` | 192 | 5.24 | 57.2 | 5.31 | 56.5 | 7 201 152 | 39.52 / 39.52 | 0 |
| `wasm-media-encoders` | 128 | 3.48 | 86.2 | 3.58 | 83.8 | 4 800 384 | 25.89 / 25.89 | 2210 |
| `wasm-media-encoders` | 192 | 3.19 | 94.1 | 3.15 | 95.4 | 7 200 576 | 30.38 / 30.38 | 2210 |
| `@mediabunny/mp3-encoder` | 128 | — | — | 4.14 | 72.4 | 4 800 576 | — / 25.88 | 0 |
| `@mediabunny/mp3-encoder` | 192 | — | — | 4.01 | 74.8 | 7 200 768 | — / 30.39 | 0 |
| `@breezystack/lamejs` | 128 | 9.30 | 32.3 | 9.44 | 31.8 | 4 800 384 | 18.63 / 18.63 | 2210 |
| `@breezystack/lamejs` | 192 | 9.72 | 30.9 | 9.66 | 31.1 | 7 200 576 | 29.75 / 29.75 | 2210 |

