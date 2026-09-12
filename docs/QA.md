# Verification record

Verified on Windows 11 x64, Node 24.15.0, Electron 44.3.0, GCC 15.2.0 (MSYS2), and Python 3.14.2 on September 11, 2026.

- TypeScript type-check and ESLint pass.
- 49 unit/process tests pass. These cover whitespace/exact comparison, metadata fallback, ZIP pairing and unsafe paths, aggregation, real stdout/stderr capture, spawn errors, timeout continuation, cancellation, and output caps.
- 22 integration journeys pass against the packaged Windows executable. Only the native file picker is substituted so the test can choose known ZIP fixtures; all other functionality is real.
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
npm run test:migration
Remove-Item Env:DSA_QA_EXECUTABLE
node scripts/dev-smoke.mjs
```

Integration reports and screenshots are emitted to `.qa/session-*/`. Development smoke output is in `.qa/dev-*/`. These generated artifacts and all QA user data are ignored by Git. The QA fixtures are committed under `fixtures/`.

The sidebar update is verified in the packaged app: hiding the library grows Monaco without losing edited code, Ctrl+K restores the library and focuses search, and the hidden state survives restart. Both initial launch and restart open maximized. Small font subsets are emitted as local files instead of data URLs to satisfy the existing strict font CSP; the complete packaged journey reports no renderer errors.

## Folder library update — September 12, 2026

The folder journeys create a Vietnamese course/homework/week hierarchy, require an explicit ZIP import destination, move a problem through root and nested folders while retaining code, rename and reparent a folder, reject duplicates and cycles, enforce empty-only deletion with cancellation/confirmation, search collapsed branches, and verify the hierarchy after restart. A missing import destination is rejected without adding a partial problem. Visual inspection includes the nested tree and breadcrumb at desktop sizes.

`npm run test:migration` creates an isolated database using the historical v1 schema in `fixtures/legacy-v1.sql`. The actual Electron application upgrades it, restores the selected approach/language, retains both source texts and input/output files, moves the legacy problem into a new folder, and restores that move on a second launch. It supports the same `DSA_QA_EXECUTABLE` override as the main integration suite. User data is never used by these tests.

The installer is unsigned. Installer generation and the packaged runtime are verified; interactive installer wizard clicks and installation into the user's normal Programs directory are not part of the automated suite.

## Typography update

The UI now uses locally bundled Space Grotesk Variable (body 540, controls 600, headings 670); Monaco and technical values use JetBrains Mono Variable at 570, including a real italic font for comments. Fontsource's Vietnamese subsets and both OFL licenses are included. Previous font imports and dependencies were removed.

A focused Electron visual check passes in both the production build and the packaged executable. It imports a Vietnamese problem and inspects computed weights and Chromium's actual platform-font usage for headings, body text, navigation, tabs, Monaco code/comments, test IDs, timings, complexity notation, and actual output. It also checks Monaco find-widget typography, Python syntax diagnostics, local-only font requests, and the 1366×768 layout. Screenshots and font reports are in `.qa/fonts-*/`.

## Interface refinement — September 12, 2026

The light interface now shares consistent surfaces, borders, control sizes and aligned statement/editor toolbars. The wider library uses compact folder/problem rows, bounded breadcrumbs and distinct selection states. Import previews group package information before the destination selector; form spacing and sticky dialog actions are consistent across import, folder management and Environment. Environment data actions use their own styles so they remain visible independently of tree hover states.

The results pane has All tests / Failures filters with counts, automatically expanded failed groups, verdict badges and compact timing statistics. A mixed AC/WA integration scenario verifies that filtering hides accepted cases without changing the run verdict or losing the complete suite. Runtime diagnostics and output comparisons precede test input. Layout assertions check toolbar alignment and control heights; visual inspection covers empty/import/workspace/results/folder/Environment views, a 1366×768 window and long Vietnamese folder paths. Current visual captures are under `.qa/polish-*/`.
