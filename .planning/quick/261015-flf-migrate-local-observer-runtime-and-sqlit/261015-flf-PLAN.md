# Bun Migration Implementation Plan

**Goal:** Run, install and verify Local Observer entirely with Bun, with real native SQLite fixtures and preserved read-only/security behavior.

**Architecture:** Retain CommonJS and existing Node-compatible HTTP, filesystem, crypto, VM and child-process APIs on Bun. Replace the SQLite loader inside the existing private-snapshot boundary with `bun:sqlite` directly; bus and helper consumers keep synchronous prepared statements and existing public response shapes. Keep the custom isolated-file regression runner.

**Tech stack:** Bun 1.3.13+, dependency-free CommonJS JavaScript, Bun native SQLite, compatible `node:` APIs, existing Python/Git/Herdr/Swift adapters and assertion scripts.

## Global constraints

- User requested full Bun migration, overriding the previous Node requirement; no Node runtime dependency or compatibility fallback remains in the application launch/test paths.
- **Privacy:** Loopback binding, per-launch API token, origin checks, bounded reads, identity checks, and redaction must remain intact. Presentation masking does not guarantee anonymity.
- **Truthfulness:** Missing sources remain unavailable and stale observations remain marked stale; unresolved identities must not open guessed transcripts.
- **Independence:** No StarNet checkout, account, cloud service, database server, or provider API key is required by the observer.
- macOS remains the supported initial target. No package dependencies, ESM conversion, test framework migration, HTTP rewrite, or speculative runtime abstraction.
- SQLite opens only verified private snapshots. Never open/checkpoint/change a live bus or Codex DB, even with a readonly option. Keep bounded copies, mode restrictions, mutation retries and immediate cleanup.
- Existing environment filtering and explicit env overrides remain intact. Disable Bun implicit dotenv loading for supported app/test entrypoints so launch cwd cannot silently change configuration or reload credentials.
- No paid/live integration runs without explicit approval. Use synthetic fixtures and injected observers; automated loopback HTTP and temporary local processes are allowed verification.
- Preserve others' dirty/untracked work. Recheck peer ownership before overlapping edits; use a feature worktree from `main` only after implementation approval and registration.

## Acceptance criteria traceability

| Requirement | Task(s) | Verification |
| --- | --- | --- |
| Bus and helper SQLite work through native Bun API; fixtures cannot silently skip | 1 | `bun --no-env-file test/observer-bus.test.js`; `bun --no-env-file test/observer-helpers.test.js` pass all unconditional fixture assertions |
| Source DB/WAL/journal bytes, permissions, fingerprint/replacement identity, cleanup, caps, redaction and stale behavior survive | 1 | Same native fixture scripts, including existing live-WAL hashes, mutation retries, cleanup/error and identity cases |
| Bun-only scripts, executable, minimum version and dependency-free installation | 2 | `bun install --frozen-lockfile`, `bun run test`, `bun run start --help`, `./server.js --help`; package/lock inspection |
| No dotenv introduction, guarded subprocess leak or protocol regression | 2 | `bun --no-env-file test/config.test.js`; `bun --no-env-file test/child-env.test.js`; `bun --no-env-file test/server.test.js`; full suite |
| Active help/setup/config examples and canonical runtime instructions agree | 2 | Help output plus scoped `rg -n 'node server\.js|npm (ci|start|test|run)|node:sqlite|Node\.js 22' README.md sidecar/config.js package.json .planning/PROJECT.md AGENTS.md frontend/` has no active old-runtime guidance; retain explicitly historical proof |

## Execution topology

| Wave | Tasks | Mode | Prerequisites | Isolation and integration | Wave verification |
| --- | --- | --- | --- | --- | --- |
| 1 | Task 1 | sequential-only | Plan approved, feature worktree and GSD quick registration | Fresh implementer owns listed files on feature branch; controller verifies and independent reviewer accepts before next task | Both SQLite scripts and `bun --no-env-file scripts/test.js` pass |
| 2 | Task 2 | sequential-only | Task 1 accepted | Same feature worktree; integrates native DB, runtime children, toolchain and docs together | `bun install --frozen-lockfile` and `bun run test` pass without fixture skips |

- Parallel implementation permission: not-requested. Tasks share runtime/test contracts and must integrate sequentially.
- Host/model policy: Codex; planner, implementer/fixer, task/final/PR reviewer all request `gpt-6.1-sol`, `medium` through native controls. No user override. Selected native controls must be recorded by controller; do not claim inferred identity where host does not expose it. Plan author cannot implement or independently review this plan.
- Controller records each task's checks, review verdict, fix loop count, cleanup and residuals in FLOW.json, following executor verification and fresh independent reviewer gates with `wnz-code-reviewer` and `wnz-clean-code-js`. Do not duplicate passed gates on unchanged scope.

### Task 1: Replace SQLite at the snapshot boundary and require native fixtures

**Goal:** Bus and helper reads execute with Bun SQLite and all existing snapshot integrity proofs run instead of skipping.

**Execution:**

- Prerequisites: none beyond approved workflow registration.
- Wave: 1.
- Mode: sequential-only; both fixtures consume the single SQLite boundary.
- Isolation: approved feature worktree; own only files listed below.
- Integration order: first; full Bun custom suite is usable before toolchain changes.

**Files:**

- Modify: `sidecar/observer-bus.js:loadNodeSqlite`, `makePrivateSnapshotQuery`, `makeBusReader`.
- Test: `test/observer-bus.test.js` native fixture/loadSqlite classes; `test/observer-helpers.test.js` real WAL fixture.
- Read-only consumer: `sidecar/observer-helpers.js:makeHelperObserver` (change only if native API requires a demonstrated correction).

**Read first:**

- `sidecar/observer-bus.js:fingerprint`, `stableCopy`, `messageIdentity` — source proof and privacy boundary.
- `sidecar/observer-bus.js:makeBusReader` — metadata-only selection, inspection, reuse and stale-state semantics.
- `test/observer-bus.test.js:SCHEMA` and WAL/mutation/replacement/cleanup cases — regression contracts.
- `test/observer-helpers.test.js` real WAL block — shared-query consumer and transcript identity proof.
- DISCOVERY.md official SQLite references and installed-version probes.

**Current-state evidence:**

- `loadNodeSqlite` lazily returns `require('node:sqlite')`; `makePrivateSnapshotQuery` extracts `DatabaseSync`, opens only a private copy and calls `close()` before source revalidation/final cleanup.
- Bus and helper tests catch SQLite import errors and skip real fixtures on Bun; loader mocks/subclasses expose `{ DatabaseSync }`.
- Native Bun 1.3.13 on this Mac retains WAL sidecars after close; existing bus closed-writer assertion expects only `bus.sqlite3`. Current API-compatible `prepare`, `get`, `all`, `exec` and bigint fs times have been probed.

**Intended edits:**

- Require `bun:sqlite` unconditionally in native fixture scripts. Remove catch-and-skip branches; update fixture constructors/subclasses and injected loader mocks to `{ Database }`. Keep intentional unsupported-loader tests to exercise fail-closed behavior, without representing Node compatibility.
- Rename lazy loader to `loadBunSqlite`, returning `require('bun:sqlite')`; destructure/validate `Database` and construct the verified private copy only. Preserve callback interface and error/retry paths.
- Use native immediate `close(true)` for private handles and error cleanup, including injected close-failure tests. Ensure retained prepared statements cannot postpone snapshot handle release.
- Preserve the live-WAL test before closing its writer. For its later explicitly journal-free fixture, call writer `fileControl(constants.SQLITE_FCNTL_PERSIST_WAL, 0)`, `exec('PRAGMA wal_checkpoint(TRUNCATE)')`, then `close(true)`; assert only the fixture DB remains before reading. These operations belong only to the test-owned writer. Keep source-byte/hash equality checks across every observer read.
- Preserve all existing mutation, identity/incarnation, secret/body-selection, bounded read, stale-row/cache reuse and cleanup cases. Add only a narrow positive assertion for native bigint fingerprint fields if missing; never replace ns identity with ms precision or `undefined` strings.

**Interfaces:**

- Consumes: `loadSqlite: () => ({ Database })`; native `new Database(snapshotPath)`, `prepare(sql).all()/get(...params)`, `close(true)`.
- Produces: unchanged `makePrivateSnapshotQuery(options)(select)` result/reason/fingerprint shape, `makeBusReader().read()/inspect()`, and helper children/inspection contracts.

**Dead-code scope:** Search `sidecar/` and `test/` for `loadNodeSqlite`, `DatabaseSync`, `node:sqlite` and fixture-skip messages. Remove migrated aliases/comments and skip wrappers; retain injectable unsupported/error cases because they prove unavailable behavior. No generic SQL adapter is needed.

**Review target:** Native close and macOS WAL semantics, actual fixture execution, source immutability, fingerprint and identity proofs, bounded metadata/body reads, stale failures and secret-safe cleanup diagnostics.

- [ ] **Step 1: Establish the pre-change check**
  - Require native fixtures and update their direct constructors/injected contract to `Database`; retain all safety assertions.
  - Cleanup: identify each loader injection and close override in both test files before renaming.
- [ ] **Step 2: Prove the check exposes the intended gap**
  - Run: `bun --no-env-file test/observer-bus.test.js` and `bun --no-env-file test/observer-helpers.test.js`.
  - Expect: a positive real database read fails because production still expects `DatabaseSync`/loads `node:sqlite`; no skipped-fixture message.
  - Cleanup: temporary fixture roots are removed by existing finally blocks; no production data is used.
- [ ] **Step 3: Implement the minimum behavior**
  - Change: native loader/extraction/close behavior above; make fixture writer shutdown explicit for macOS only within test-owned data.
  - Cleanup: remove obsolete Node SQLite aliases and skip paths; preserve loader injection rather than adding an adapter.
- [ ] **Step 4: Prove the focused behavior passes**
  - Run: both focused SQLite scripts above.
  - Expect: available bus/helper rows, WAL-only commits visible, immutable source hashes, rejected unstable/replaced identities and empty scratch roots; native fixtures cannot skip.
  - Cleanup: search affected tests for hidden conditional fixture execution and deferred native closes.
- [ ] **Step 5: Run the task gate**
  - Run: `bun --no-env-file scripts/test.js`; `git diff --check`; `rg -n 'node:sqlite|DatabaseSync|loadNodeSqlite|fixture database checks skipped' sidecar test`.
  - Expect: all discovered test files pass; no whitespace errors or obsolete SQLite references.
  - Cleanup: verify no snapshot/test artifacts survive, and no new library/dependency was added.
- [ ] **Step 6: Review and record the task**
  - Review: fresh independent reviewer traces private copy creation through all readers, error cleanup and native fixtures.
  - Record: controller check output, review loop count and remaining risks in FLOW.json; no claim of live integration proof.
  - Cleanup: reviewer confirms every removed alias/skip has updated consumers and preserved unsupported paths are justified.

### Task 2: Make Bun the supported launch, install and verification toolchain

**Goal:** All supported app/test commands use Bun with controlled environment semantics and accurate active documentation.

**Execution:**

- Prerequisites: Task 1 accepted.
- Wave: 2.
- Mode: sequential-only; startup/config/test/docs must agree on native flags.
- Isolation: same approved feature worktree; no other session checkout edits.
- Integration order: second; controller owns final delivery and local instruction synchronization.

**Files:**

- Modify: `package.json:engines`, `packageManager`, `scripts`; `server.js` shebang; `scripts/test.js:spawnSync`; `sidecar/config.js:HELP`.
- Modify: `frontend/app/observer.js:busHealth`; `frontend/app/observer-mail-inspector.js:REASONS.unsupported` — runtime diagnostic text only.
- Modify tests: `test/config.test.js` CLI launch cases; `test/observer-identity.test.js` current-runtime child spawn.
- Create: `bunfig.toml` (`env = false`); `bun.lock` only if Bun generates a text lockfile for this empty dependency graph; `test/child-env.test.js`.
- Remove: `package-lock.json` after using Bun to migrate installation metadata.
- Docs: `README.md` active runtime/commands; `.planning/PROJECT.md:Constraints`; `AGENTS.md` generated project excerpt.
- Controller-owned local guidance: `.codex/config.toml` runtime note, excluded from commits; update only conflicting Node/Bun runtime/test wording. CLAUDE.md already delegates to AGENTS and needs no parallel prose.
- Verify read-only: `sidecar/child-env.js`; `test/server.test.js`; existing VM/frontend, transcript/identity, project and desktop suites. Change production subprocess behavior only for a concrete failing contract.

**Read first:**

- `package.json`, `scripts/test.js`, `server.js` bootstrap/signal handlers, `sidecar/config.js:HELP`.
- `sidecar/child-env.js:stationChildEnv`, `withStationEnv`, `guardChildProcess`; observer/identity/project execute callers.
- `test/config.test.js` cwd-dependent CLI cases; `test/server.test.js` real HTTP boundary.
- `frontend/app/observer.js:busHealth`; `frontend/app/observer-mail-inspector.js:REASONS.unsupported` — unavailable-source diagnostics.
- `README.md` command corpus; `.planning/PROJECT.md:Constraints`; generated block markers in AGENTS.md.

**Current-state evidence:**

- Package scripts and executable shebang use Node; runner/CLI/identity children inherit `process.execPath` without runtime flags. HELP says `node server.js`.
- `frontend/app/observer.js:busHealth` and `frontend/app/observer-mail-inspector.js:REASONS.unsupported` still tell users the bus reader needs Node with `node:sqlite`; only these diagnostic strings require UI edits.
- Runner already discovers sorted test scripts, checks spawn errors and propagates failure; no test framework is needed.
- Child guard defaults omitted env to filtered values and honors explicit env. Bun child probe still autoloaded cwd `.env` after env filtering; native `--no-env-file` and project `env = false` prevented it on installed Bun.
- Current Bun baseline passed HTTP token/origin/static confinement and VM tests; retain these implementations and use the full suite as compatibility proof.

**Intended edits:**

- Set `engines` to `{ "bun": ">=1.3.13" }`, `packageManager` to `bun@1.3.13`, and scripts to `bun --no-env-file server.js`, `bun --no-env-file scripts/test.js`, and `bun --no-env-file server.js --presentation`. Keep `bin.starnet-observer` pointing at server.js; use executable shebang `#!/usr/bin/env -S bun --no-env-file` on supported macOS.
- Add project `bunfig.toml` with `env = false` so `bun run` itself cannot preload cwd `.env` before invoking scripts. Add `--no-env-file` before script/`-e` in current-runtime child launches in runner/config/identity tests; retain process.execPath, ordering and exit propagation.
- Keep CLI launch checks in `test/config.test.js`: execute help using direct Bun with `--no-env-file` and the executable shebang; assert success and Bun usage. Verify `bun run start --help` and presentation/config flag forwarding. Help returns before PORT evaluation, so successful help/no disclosed canary is not dotenv-isolation proof. Use no live observer startup for these checks.
- In `test/child-env.test.js`, use a disposable cwd `.env` with a unique synthetic canary and explicit sanitized parent env omitting it. Invoke `process.execPath` with `-e` code that exits nonzero if `process.env` contains that canary: once with `--no-env-file`, once with `--config` pointing to the project `bunfig.toml` and no disabling flag. Assert both exit 0. A control invocation without either native control must exit nonzero, proving the check observes autoload. This uses existing subprocess seams and no production interface.
- Add `test/child-env.test.js` using temporary fixture files and the existing guard. Assert namespace/name/value filtering and preserved PATH, explicit env override behavior, real guarded `execFile` callback output, timeout and maxBuffer failures. A child invoked with `--no-env-file` in a cwd `.env` must not reload a stripped canary. Exercise production-used API shapes, not an unused full seven-method matrix. Preserve security guard API and behavior unless this test demonstrates a Bun incompatibility.
- Generate installation metadata with `bun install --lockfile-only`, inspect resulting zero-dependency graph, remove npm lockfile and use `bun install --frozen-lockfile`. If Bun intentionally emits no lockfile for an empty project, record output and document the real zero-dependency behavior; do not hand-author a fake lockfile or introduce a package to force one.
- Replace only the two unsupported SQLite diagnostics with truthful Bun runtime wording (for example, “Bus SQLite support unavailable; use the supported Bun runtime”). Preserve their unavailable states, last-known suffix, reason mapping and inspector refusal; no UI redesign. Include `frontend/` in the obsolete Node/SQLite guidance search.
- Change README install/update/test and presentation/theme/port examples to verified Bun commands (`bun run start`, `bun run presentation`, `bun run test`, flags directly after script name). Document arbitrary-cwd direct launch as `bun --no-env-file /path/to/starnet-observer/server.js`; no Node executable is required. Describe implicit dotenv disabled, shell-exported configuration retained, optional external tools unchanged.
- Update PROJECT runtime constraint and generated AGENTS project constraint consistently to Bun baseline/native SQLite/no package dependencies. Preserve dated historical Node verification as history; add actual fresh Bun verification only after output exists. Controller updates its local runtime guidance without committing personal tooling or changing historical quick plans.

**Interfaces:**

- Consumes: existing config flags/env, custom test discovery and guarded child API.
- Produces: Bun package scripts, executable CLI/help, frozen-install procedure and unchanged API/frontend behavior. Public CLI flags remain unchanged.

**Dead-code scope:** Search active package/scripts/config/frontend/README/PROJECT/generated instructions for obsolete Node startup and npm commands; remove npm lockfile after migration. Retain compatible `node:` imports and dated historical records. No new launcher, framework or shared test helper is justified.

**Review target:** Every supported launch path disables implicit dotenv, runtime children truly use Bun, failure propagation remains intact, native guard behavior and HTTP/VM regressions pass, package metadata/docs agree and no personal config is committed.

- [ ] **Step 1: Establish the pre-change check**
  - Add: CLI launch checks to config tests and observable process-env isolation/control assertions plus focused native guarded-child tests above.
  - Characterize: old scripts/shebang/help/engine/lockfile with scoped search. Mechanical metadata/docs use inspection rather than tests that mirror strings.
  - Cleanup: trace runtime child invocations and distinguish compatible `node:` imports from obsolete Node launch requirements.
- [ ] **Step 2: Prove the check exposes the intended gap**
  - Run: `bun --no-env-file test/config.test.js`; `bun --no-env-file test/child-env.test.js`.
  - Expect: new executable/help runtime assertions fail before migration; guard characterization may already pass and must stay green. Record exact missing-runtime failure rather than manufacturing a guard defect.
  - Cleanup: temporary env/process fixtures close and remove their roots in finally blocks.
- [ ] **Step 3: Implement the minimum behavior**
  - Change: metadata, native env configuration/flags, executable, HELP, the two unsupported SQLite diagnostics and scoped active documentation; generate lock metadata, then remove npm lockfile.
  - Cleanup: no obsolete package script or Node-only help remains; retain existing CommonJS/subprocess/HTTP/VM code when checks pass.
- [ ] **Step 4: Prove the focused behavior passes**
  - Run: config, child-env and server scripts with `bun --no-env-file`; `bun run start --help`; `bun run presentation --help`; `./server.js --help`; `bun --no-env-file server.js --config themes/basic.json --help`; `bun --no-env-file server.js --config themes/helioforge.json --help`.
  - Expect: CLI commands exit 0 with Bun usage/forwarded flags; disposable process-env assertions prove canary absence with native controls and presence without them, native child limits enforced, HTTP boundaries unchanged. Help output is launch proof only.
  - Cleanup: no temp files, server sockets or child processes remain.
- [ ] **Step 5: Run the task gate**
  - Run: `bun install --frozen-lockfile`; `bun run test`; `git diff --check`; scoped active-guidance search from acceptance table; `git status --short`.
  - Expect: reproducible zero-dependency install, all discovered tests including mandatory SQLite fixtures pass, no active Node requirement, only owned branch changes. Record whether Bun generated a lockfile.
  - Cleanup: confirm package-lock is removed, no generated downloaded tooling/foreign files staged, no speculative adapter or orphaned scripts.
- [ ] **Step 6: Review and record the task**
  - Review: fresh independent reviewer traces runtime entries/child environments, metadata/install/docs and full regression output; controller performs aggregate branch review across both tasks.
  - Record: FLOW.json evidence, fix loop count, native runtime version and any residual limit; no live-desktop claim.
  - Cleanup: reviewer verifies deletions, dynamic bin/script consumers and retained historical Node evidence.

## Approval and delivery

Controller runs simplicity review, executor self-review and fresh read-only independent plan gate before offering Plannotator annotation and requesting plan approval. Material feedback starts the prescribed review cycle. No implementation begins from this document alone.

After approval, create the ticket feature branch/worktree from `main`; register the verbatim approved plan through only the registration portion of local `$gsd-quick`, add Registered Work to `.planning/STATE.md`, and record branch/quick path in private FLOW.json. Run tasks through executor implementation/controller verification/independent task review/fix loops. Update tracked quick context/state only at prescribed milestones inside the feature worktree.

After final aggregate review, create the PR with concrete behavior and fresh evidence, run `wnz-code-reviewer` PR review/fix loops until no High/Medium findings and configured checks pass. Commit final quick SUMMARY and move the state row to Quick Tasks Completed referencing the PR number as the last feature commit before merging. Merge with a merge commit; record merge SHA only in FLOW.json, then mark step 13/done. Never commit private FLOW.json. The migration is not complete until this approved delivery workflow finishes.
