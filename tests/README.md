# Tests

| Folder         | Layer                                        | Tooling                 |
| -------------- | -------------------------------------------- | ----------------------- |
| `unit/`        | L1/L2 pure logic, including structure checks | Vitest                  |
| `integration/` | L2 simulated-clock integration tests         | Vitest                  |
| `e2e/`         | L4 Electron launch and user flows            | Playwright for Electron |
| `fixtures/`    | Golden tables, sample sessions and presets   | —                       |

Per-layer unit tests live next to the code they cover (`src/**/**.test.ts`);
this folder holds cross-layer tests.
