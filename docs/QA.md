# Verification record

Verified on Windows 11 x64, Node 24.15.0, Electron 44.3.0, GCC 15.2.0 (MSYS2), and Python 3.14.2 on September 11, 2026.

- TypeScript type-check and ESLint pass.
- 49 unit/process tests pass. These cover whitespace/exact comparison, metadata fallback, ZIP pairing and unsafe paths, aggregation, real stdout/stderr capture, spawn errors, timeout continuation, cancellation, and output caps.
- 18 integration journeys pass against the packaged Windows executable. Only the native file picker is substituted so the test can choose known ZIP fixtures; all other functionality is real.
- Production renderer reports no console errors or uncaught exceptions during these journeys.
- Visual screenshots inspected for first launch, accepted/failed results, Environment, and the 1366×768 workspace.
- Development launch through electron-vite passes with context isolation, sandboxing, and the development CSP intact.
- NSIS x64 installer generation succeeds. The unpacked packaged executable loads its Electron-native SQLite binary and locally bundled Monaco workers/fonts, imports problems, and calls the system toolchains.
- npm audit reports zero known vulnerabilities at verification time.

The packaged journeys cover empty-state startup, renderer Node isolation, ZIP preview/commit, Markdown, GCC/Python detection, AC/WA/TLE/RE/OLE, compile and Python syntax errors, compiler line navigation, colored Monaco syntax and find, cancellation, double-run rejection, immutable run snapshots, autosave during execution, approach/language switching, rename, immediate-close persistence, malformed imports without partial library entries, missing tools, IPC input rejection, compact layout, and confirmed deletion.

Reproduce:

```powershell
npm run typecheck
npm run lint
npm test
npm run dist:win
$env:DSA_QA_EXECUTABLE = "$PWD\release\win-unpacked\DSA Lab.exe"
npm run test:e2e
Remove-Item Env:DSA_QA_EXECUTABLE
node scripts/dev-smoke.mjs
```

Integration reports and screenshots are emitted to `.qa/session-*/`. Development smoke output is in `.qa/dev-*/`. These generated artifacts and all QA user data are ignored by Git. The QA fixtures are committed under `fixtures/`.

The installer is unsigned. Installer generation and the packaged runtime are verified; interactive installer wizard clicks and installation into the user's normal Programs directory are not part of the automated suite.

## Typography update

The UI now uses locally bundled Space Grotesk Variable (body 540, controls 600, headings 670); Monaco and technical values use JetBrains Mono Variable at 570, including a real italic font for comments. Fontsource's Vietnamese subsets and both OFL licenses are included. Previous font imports and dependencies were removed.

A focused Electron visual check passes in both the production build and the packaged executable. It imports a Vietnamese problem and inspects computed weights and Chromium's actual platform-font usage for headings, body text, navigation, tabs, Monaco code/comments, test IDs, timings, complexity notation, and actual output. It also checks Monaco find-widget typography, Python syntax diagnostics, local-only font requests, and the 1366×768 layout. Screenshots and font reports are in `.qa/fonts-*/`.
