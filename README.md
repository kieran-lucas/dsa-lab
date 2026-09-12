# DSA Lab

A local Windows desktop workspace for practicing algorithms. Import a ZIP, keep named C++ and Python approaches, and run every test with grouped verdicts, diagnostics, and individual wall-clock timings. All problem data and code stay on your machine.

Typography is bundled locally: **Space Grotesk Variable** for the UI (body 540, controls 600, headings 670) and **JetBrains Mono Variable** for Monaco and technical values (570). Both include Vietnamese glyphs; JetBrains Mono also includes its real italic face for code comments. No font CDN is used. Shared font and weight tokens live in `src/renderer/styles.css`; Monaco's explicit font configuration lives in `src/renderer/components/CodeEditor.tsx`.

## Requirements

- Windows 11 x64 recommended.
- For C++: a GCC / MinGW toolchain with `g++` on `PATH` and C++20 support.
- For Python: Python 3 through `py -3` or `python` on `PATH`.
- For development: Node.js 22.12+ (Node 24 recommended) and npm. Installation needs internet; the installed application works offline.

The app does not bundle a compiler or Python runtime. Use **Environment** to inspect detected versions, override executable paths, and recheck. An executable path is entered without surrounding quotes. Python prefix arguments are a JSON array: for `py.exe`, use `["-3"]`; for `python.exe`, use `[]`. Blank Python executable enables automatic detection.

## Development

```powershell
npm install
npm run dev
```

`postinstall` runs `electron-builder install-app-deps` to rebuild SQLite for Electron. Commit and retain `package-lock.json`; use `npm ci` for reproducible installs.

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run preview
```

The unit tests exercise package validation, comparison, verdict aggregation, and real child-process containment. They do not require GCC or Python. The integration suite launches the actual Electron app and requires both toolchains:

```powershell
npm run build
npm run test:e2e
```

Integration tests use isolated data in `.qa/`, interact with the renderer, and mock only the native ZIP file picker. They exercise real imports, SQLite, Monaco, compilers, every test verdict, cancellation, approaches, restart persistence, and deletion. Reports and screenshots stay in `.qa/session-*/`.

## Build and package

```powershell
# Unpacked Windows application
npm run pack:win

# Per-user x64 NSIS installer
npm run dist:win
```

Outputs:

- `release/win-unpacked/DSA Lab.exe`
- `release/DSA-Lab-1.0.0-x64-Setup.exe`

The installer does not require administrator permissions and preserves user data during uninstall. The development build is unsigned; distributing a signed installer requires your own Windows code-signing certificate. Native `.node` binaries are unpacked from ASAR.

To exercise the packaged application:

```powershell
$env:DSA_QA_EXECUTABLE = "$PWD\release\win-unpacked\DSA Lab.exe"
npm run test:e2e
Remove-Item Env:DSA_QA_EXECUTABLE
```

## Use the workspace

1. Select **Library** or a folder, then use **New folder** to organize courses and homework. For example: `DSA UET / Bài tập về nhà / Tuần 1`.
2. Click **Import problem**, choose a ZIP, review the preview, choose **Import into**, then click **Import**. A destination is required; **Library (top level)** keeps a problem outside folders.
3. Select an approach or use **+** to create one. Each approach has independent C++ and Python code.
4. Write in Monaco. Code saves after 450 ms and is flushed before switching or closing normally.
5. Press **Run All** or **Ctrl+Enter**. Compilation/preflight happens once; every test runs sequentially, including tests after WA, TLE, RE, or OLE. **Cancel Run** stops the active child and retains completed results.
6. Expand a group, then a case to inspect input, expected output, actual output, and stderr. Diagnostic line links focus the editor.

Use **Failures** in the results pane to show only failed cases and open their groups automatically. **All tests** restores the complete suite. Runtime diagnostics and expected/actual output appear before the input for quicker inspection; filtering never changes verdicts or stops test execution.

Folder chevrons expand/collapse the tree; clicking a folder selects the parent for **New folder**. Use a folder's **…** button to rename it or change its parent. Only empty folders can be deleted, with confirmation. The **Move problem** button above the statement moves an existing problem with its saved approaches and tests. Search finds problems across all folders, including collapsed branches, and displays their paths. Folder names support Vietnamese; duplicate sibling names and moves into a folder's own descendants are rejected. Nesting is supported up to 32 levels.

Existing libraries upgrade automatically: previous problems stay at the top level with their IDs, code and tests intact. Folders are logical organization in SQLite; the internally generated `problems/<uuid>` storage paths remain stable when you rename or move items. Expanded folders and the selected folder are restored on restart. Verify upgrades from the original schema with `npm run build` followed by `npm run test:migration`.

The app opens maximized, keeping the native Windows title bar. Use the sidebar button beside the logo to hide or show the library and make more room for the statement and editor. Its state is remembered across restarts.

**Ctrl+K** opens the library if hidden and focuses search. **Ctrl+S** immediately saves. **Ctrl+F** opens Monaco find. Drag the dividers to resize panels; focused dividers also respond to arrow keys. The last problem, approach, language, and panel proportions are restored on restart.

Run All takes a source snapshot. Edits during execution are for the next run. Navigation is disabled during a run. Overall **Passed** requires all cases to be AC. **Compile Error** runs no tests. A cancelled suite is always **Cancelled**.

## ZIP format

ZIP the contents directly; do not include a wrapping problem folder.

```text
my-problem.zip
├── problem.md
├── meta.json                 # optional
└── tests/
    ├── sample/
    │   ├── 001.in
    │   └── 001.out
    ├── boundary/
    │   ├── 001.in
    │   └── 001.out
    └── random/
        ├── 001.in
        └── 001.out
```

Every `.in` needs a same-directory, same-stem `.out`, and vice versa. The first directory beneath `tests/` supplies the group. Pairs directly inside `tests/` go into **General**. Nested paths within a group are supported. The external-generator convention `input001.txt` / `output001.txt` is also accepted. Duplicate logical pairs and case-insensitive duplicate paths are rejected.

`problem.md` is required and read-only. Use UTF-8 text for statements, metadata, and test contents. Markdown supports headings, tables, lists, emphasis, code, and blockquotes; raw HTML does not execute. External resources and links are not loaded. ZIP contents never become solution code automatically.

Optional `meta.json`:

```json
{
  "title": "Sum of Two Numbers",
  "topic": "Foundations",
  "timeLimitMs": { "cpp": 2000, "python": 5000 },
  "outputComparison": "tokens"
}
```

All fields are optional. Title falls back to the first Markdown H1, then the ZIP name. Default per-test limits are 2,000 ms for C++ and 5,000 ms for Python; overrides must be integers between 50 and 60,000 ms. `tokens` ignores whitespace, without numeric tolerance. `exact` normalizes CRLF to LF but preserves all other whitespace.

Import limits: 128 MB ZIP, 5,000 entries, 512 MB declared uncompressed data, 16 MB per test file, 4 MB statement, 64 KB metadata. Absolute paths, traversal, Windows device names, encrypted entries, symbolic links, CRC corruption, missing pairs, and unsupported layouts fail validation. Import first stages files and only exposes a problem after its database transaction commits. Matching titles produce separate problems.

Try the included `fixtures/sum-of-two-numbers.zip`. Its editable source is in `fixtures/sum/`; regenerate it with:

```powershell
node scripts/fixture.mjs
```

## Local storage and execution

Default data lives under Electron's per-user data directory, usually:

```text
%APPDATA%/dsa-lab/dsa-lab/
├── data.sqlite               # SQLite, WAL mode
├── problems/<uuid>/          # statement and normalized test files
├── staging/                  # uncommitted imports
└── logs/app.log
```

**Environment → Open data folder** shows the exact location. Close the app before backing up the entire directory. Code is in SQLite; tests are files. At most 100 lightweight run summaries are retained; detailed results belong to the current workspace session.

Runs use fresh `%TEMP%/dsa-lab-run-*` directories, deleted after completion or cancellation. Compilation has a 60-second cap. Each test has separate 4 MB stdout / 1 MB stderr caps; exceeding either terminates the process and gives OLE. Failed stdout and stderr previews are bounded (16 KB each, with an 8 MB aggregate retention budget); successful stdout is discarded after comparison. Input/expected previews load on demand, up to 64 KB each, and are marked when truncated. Complete input and expected files remain in problem storage.

Timing measures the full wall-clock lifetime of each spawned process, including startup and Windows scheduling overhead. It is not CPU time or a memory benchmark. Windows process trees are terminated on timeout or cancellation using `taskkill.exe /PID … /T /F`, invoked directly without a command shell.

**DSA Lab is not a security sandbox. Code executed through the local runner has the permissions of the current Windows user. Only run code you trust.** Renderer isolation protects the desktop interface; it does not restrict your compiled programs or Python scripts.

## Troubleshooting

- **g++ not found:** install a native Windows GCC / MinGW toolchain, add its `bin` folder to `PATH`, and restart the app. Alternatively choose `g++.exe` in Environment. Required compiler/runtime DLLs must be available beside the executable or on `PATH`.
- **Python not found:** verify `py -3 --version` or `python --version` in PowerShell. Choose the real `python.exe` if Windows App Execution Aliases redirect `python` to the Store.
- **SQLite native module error:** use `npm run postinstall`, then rebuild/package. A module built for regular Node cannot be substituted for an Electron native binary. If native prebuild downloads are unavailable, compiling requires Visual Studio C++ build tools and Python. Reinstall with `npm ci` if the Electron version changed.
- **Malformed ZIP:** use the documented root layout; pair every input and output. The import dialog lists specific validation failures. Re-export damaged archives rather than changing filenames inside binary ZIP data.
- **Unsaved code:** a visible save error retains the editor contents. Use **Retry save** or Ctrl+S after resolving disk permissions or free space. Normal window close waits for a successful save; forced process termination or power loss can lose the most recent debounce interval.
- **Unexpected runner failure:** inspect stderr, check the executable configuration, and use **Environment → Open logs folder**. Do not run from a deleted compiler installation.

The main process owns SQLite, ZIP parsing, files, toolchains, and processes. The sandboxed renderer gets only the typed methods in `src/shared/types.ts` through `src/preload/index.ts`. Production assets, workers, and fonts are bundled and served through an app-local protocol. Development alone uses Vite's loopback server.
