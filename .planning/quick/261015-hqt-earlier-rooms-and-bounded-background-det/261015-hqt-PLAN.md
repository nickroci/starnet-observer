# Loading Performance Implementation Plan

**Goal:** Show repository rooms sooner and reduce inspector waits through bounded background preparation, concurrent discovery, and reusable public assets.

**Architecture:** Publish verified room inventory before optional transcript, helper, desktop, and bus enrichment finishes. Keep transcript projections inside the existing bounded server cache, perform private SQLite snapshot work in one worker, and retain fresh ownership checks when serving inspection. Reuse the existing sprite loader, scene geometry, QuerySpine lifecycle, and public API shapes.

**Tech stack:** CommonJS JavaScript; native HTTP, filesystem, worker threads, and SQLite; current checkout uses Bun 1.3.13; browser QuerySpine and canvas; injected clocks and standalone assertion tests.

## Global constraints

- Preserve loopback binding, per-launch token, origin checks, redaction, private source boundaries, bounded reads, exact identities, footer proofs, helper ancestry checks, symlink confinement, and stale observations.
- No package dependencies, provider calls, paid runs, persistent private cache, extra public APIs, or transcript bodies in public inventory. Presentation mode must not prepare private detail content.
- User explicitly selected Bun-only runtime: “bun is the new runtime, no more node.” Preserve Bun 1.3.13+ and native `bun:sqlite`; do not add Node compatibility. Runtime clarification is resolved by the latest Bun-only instructions; use `bun run test`.
- Do not claim the reported lag was reproduced. The available four-session instance returned sessions in 2–3 ms and geometry in 0.5–1.5 ms; those observations do not measure the user's cold startup or click delay.
- Preserve hidden-page suspension and post-resume proof. Do not add browser subscriptions, timers, inspector caches, or speculative body fetches.
- Implement only in the ticket's isolated feature worktree after latest-plan review and user approval. Preserve incoming theme integration, route authorization, path validation, token injection, and lifecycle changes.
- Use sequential fresh implementers and independent task reviewers. Review implemented JavaScript with `wnz-code-reviewer` and `wnz-clean-code-js`. Requirement gaps and High/Medium findings with concrete defect paths require fixes.

## Acceptance criteria traceability

| Requirement | Tasks | Verification |
| --- | --- | --- |
| SQLite copies/queries do not block HTTP | 1 | Worker fixture blocks query while a static HTTP request completes; private-copy tests still pass |
| Discovery is bounded and preserves main/worktree proof | 2 | Deferred fixtures assert maximum four concurrent operations, stable order, and same room grouping regardless of pane order |
| Concurrent cold lookups share scans without weakening fresh identity checks | 2 | Count directory traversals; duplicate, symlink, replacement, and helper-inspection tests remain protective |
| Rooms arrive before optional enrichment | 3 | Hold transcript, desktop, helper, and bus promises; first room snapshot resolves without them; release and verify enrichment |
| Startup prepares bounded detail projections | 3 | Warmup starts after room publication, uses at most two reads and 32 eligible identities, then explicit inspection reuses projection while revalidating ownership |
| Hidden/resume, stale truthfulness, presentation privacy | 3 | Existing UI/inspector/presentation tests plus blocked warmup and identity-replacement fixtures |
| Public assets revalidate safely; private responses never cache | 4 | HTTP tests assert ETag/304, replacement yields new bytes, HTML/API/errors remain no-store, conditional requests cannot bypass authorization |
| Integrated behavior and no regression | 4 | `bun run test`; native Bun SQLite fixtures and synthetic startup/inspection evidence |

## Execution topology

| Wave | Tasks | Mode | Prerequisites | Isolation and integration | Wave verification |
| --- | --- | --- | --- | --- | --- |
| 1 | Task 1 | sequential-only | Bun-only clarified; plan approved | Ticket feature worktree | SQLite, helper, worker, server fixtures |
| 2 | Task 2 | sequential-only | Task 1 reviewed | Same branch; discovery and worker integration share observer owners | Transcript, project, observer fixtures |
| 3 | Task 3 | sequential-only | Task 2 reviewed | Same branch; consumes asynchronous data sources and discovery | Observer, inspector, UI, presentation fixtures |
| 4 | Task 4 | sequential-only | Task 3 reviewed | Same branch; final server lifecycle and caching integration | Full installed test script and synthetic interaction checks |

Parallel implementation permission: not requested; sequential execution avoids overlapping observer/server ownership and integration contracts.

Host/model policy: Codex. Selected native planner: `gpt-6.1-sol`, medium. Planned implementer/fixer and independent reviewers: `gpt-6.1-sol`, medium. Controller resolved model/effort controls are unavailable to this planner. No user model overrides supplied. Author cannot implement or independently review this plan.

### Task 1: Move private SQLite work off the HTTP thread

**Goal:** Keep HTTP responsive while bounded, read-only bus and helper snapshots execute.

**Execution:** Wave 1; sequential-only. Own worker transport, SQLite call sites, tests, and shutdown wiring in ticket worktree. Integrate before observer scheduling.

**Files:** Create `sidecar/observer-sqlite-worker.js`, `sidecar/observer-sqlite-client.js`, and `test/observer-sqlite-worker.test.js`. Modify `sidecar/observer-bus.js:makeBusReader`, `sidecar/observer-helpers.js:makeHelperObserver`, `sidecar/observer.js:makeObserver`, `sidecar/presentation.js:makePresentationObserver`, and `server.js:createServer`. Test `test/observer-bus.test.js`, `test/observer-helpers.test.js`, `test/server.test.js`, and `test/presentation.test.js`.

**Read first/current-state evidence:** `observer-bus.js:makePrivateSnapshotQuery` copies bounded SQLite source files synchronously into private folders, verifies source fingerprints, selects through `database.query`, and cleans in `finally`. `makeBusReader.read` already skips unchanged fingerprints and retains stale observations on failure. `observer-helpers.js:children` already awaits injectable `readEdges`; its default selector is synchronous. `server.js:createServer` does not await `inspectMessage`; CLI shutdown closes sockets only.

**Intended edits:** Keep the synchronous private-copy implementation and its defenses inside the worker. Extract the helper edge selector as `readHelperEdges(options)` in `observer-helpers.js`, reused by default synchronous fixtures and the worker. One lazily started worker owns default bus metadata reads and services fixed operations `bus.read`, `bus.inspect`, and `helpers.edges`; message bodies are queried only by explicit inspection. For `bus.inspect`, query and verify identity in the worker, then return bounded private raw inspection fields/body to the parent. Extract one owning `sanitizeMessageInspection(raw, now)` implementation in `observer-bus.js`, used by both the direct reader and parent worker adapter; it applies existing field/known-value redaction before display truncation. The main thread already owns `setKnownSecretSource`; never transfer held secrets to the worker. Private raw IPC results must never be returned directly to HTTP, public inventory, logs, or errors. No SQL strings, arbitrary functions, or executable operations cross the transport. Default production adapters use this client; directly injected test readers remain supported. Change `server.js` to await mail inspection and observer teardown.

**Interfaces:** `makeSqliteClient(options)` returns `readBus()`, `inspectMessage(id, expectedIdentity)`, `readHelperEdges()`, and `close()`, all promises. Requests contain an opaque request number and one fixed operation plus validated arguments; replies contain matching number and the existing bounded result or sanitized source-unavailable failure. The sole private exception is `bus.inspect`: its raw body is capped at `MAX_RAW_CHARS + 1` alongside only the existing inspection fields needed for verified identity and truncation. Parent `inspectMessage` sanitizes that private reply through `sanitizeMessageInspection(raw, now)` before returning the existing public shape. Worker receives only required database paths, private temporary root, and clock values; inherit child-environment hygiene and do not copy tokens into messages. `makeObserver` exposes idempotent asynchronous `close()`; presentation wrapper forwards close without exposing private methods. Existing public response shapes remain unchanged.

Allow at most one active SQLite job and eight queued jobs; coalesce queued/in-flight metadata reads. An overflow fails unavailable rather than growing memory. Explicit inspections precede queued refresh metadata without interrupting an active copy. Timeout at 10 seconds rejects affected callers and terminates the worker; next demand can create a fresh worker. Do not replay timed-out inspection automatically. Worker error/exit rejects every pending promise. Track each worker's private snapshot folder under the parent's private temporary root so forced termination and server close remove abandoned copies after worker exit. Graceful close stops admission, finishes or rejects accepted jobs within the same deadline, terminates/unrefs resources, and is safe twice. Failed bus reads retain their last good rows and observedAt; never restamp old results as newly observed.

**Dead-code scope:** Trace `makePrivateSnapshotQuery`, default loaders/selectors, bus read/inspect callers, helper `readEdges`, server close, and presentation wrapper. Remove replaced default main-thread SQLite wiring; preserve direct synchronous fixture APIs and public exports still consumed.

**Review target:** Worker queue/lifecycle, cleanup under termination, no live-source mutation, source fingerprint identity, stale retention, parent-owned known-value redaction before clipping, raw-IPC confinement, sanitized failures, and every HTTP/body call site.

- [ ] Establish deferred worker and private-copy fixtures; assert a static HTTP request finishes while database work waits. Register an ordinary-shaped known-secret canary with main-thread `setKnownSecretSource` and assert the worker HTTP inspection path redacts it before display clipping, including near the clipping boundary. Inspect default selector/sanitizer callers before editing.
- [ ] Run `bun --no-env-file test/observer-sqlite-worker.test.js`; expect absent worker transport to fail responsiveness/queue assertions. Test-only additions have no production removal yet.
- [ ] Implement fixed-operation worker, async default adapters, awaited mail route, and owned shutdown. Remove superseded default main-thread wiring after tracing consumers.
- [ ] Run `bun --no-env-file test/observer-bus.test.js`, `bun --no-env-file test/observer-helpers.test.js`, and `bun --no-env-file test/observer-sqlite-worker.test.js`; expect native fixtures, unchanged-source reuse, queue, crash, timeout, source replacement, main-thread known-secret redaction, clipping order, and cleanup assertions to pass. Check final export references.
- [ ] Run `bun --no-env-file test/server.test.js` and `bun --no-env-file test/presentation.test.js`; expect asynchronous bodies and double-close cleanup without route/privacy regression. Record retained direct-reader APIs and why they remain supported.
- [ ] Fresh independent task review; record requirements/quality verdicts, verification, cleanup evidence, and residuals in FLOW.json.

### Task 2: Bound concurrent discovery and share directory scans

**Goal:** Reduce serial source discovery while preserving deterministic grouping and fresh helper identity proofs.

**Execution:** Wave 2; sequential-only after Task 1 review. Own discovery changes in `sidecar/observer.js:refreshHerdr`, `sidecar/observer-projects.js:makeProjectResolver`, `sidecar/observer-transcripts.js:makeTranscriptObserver`, and `sidecar/observer-helpers.js:children`. Tests: `test/observer.test.js`, `test/observer-projects.test.js`, `test/observer-transcripts.test.js`, `test/observer-helpers.test.js`.

**Read first/current-state evidence:** `refreshHerdr` resolves identities in a batch, then awaits transcript and project resolution serially per pane. `observer-projects.js:resolve` proves a linked worktree only through one previously observed fresh main-checkout cache entry. `observer-transcripts.js:locate` has a 60-second index but no in-flight scan sharing; helper discovery clears the complete index through `resetHelperIndex`. Detailed Codex helper reads explicitly force fresh uniqueness discovery. Preserve that inspection-time freshness.

**Intended edits:** Add `projects.resolveMany(cwds)` returning values in input order, deduplicating cwd work and bounding Git/filesystem discovery to four operations. Separate main-checkout discovery from linked association: discover canonical Git identities concurrently, register verified observed main checkouts, then resolve linked checkouts against that evidence with existing main revalidation and ambiguity rejection. Preserve `resolve(cwd)` for existing callers and injected `projects.resolve` adapters. Process transcript summaries with a maximum of four concurrent row reads and stable input order. Per-source errors keep their current fail-closed behavior.

Replace blanket helper index clearing with one explicit `transcripts.beginDiscovery()` at the start of a roster enrichment sweep. It invalidates lookup indices for that sweep before summary reads; helper discovery reuses that sweep's completed index instead of clearing it again. `locate` shares an in-flight traversal per provider, including concurrently forced traversals. A forced lookup must never join an older nonforced traversal or reuse a completed TTL index as proof; queue one fresh traversal after the older traversal if necessary. Keep a generation counter so superseded scans cannot overwrite newer indices. Failed/over-limit traversals clear pending work and do not publish partial indices. Ordinary TTL remains 60 seconds; all explicit Codex helper detail reads still force a current uniqueness scan and revalidate bound paths/content.

**Interfaces:** `projects.resolveMany(cwds: string[])` produces project objects aligned with input order. `transcripts.beginDiscovery()` starts a fresh private scan generation; caller invokes once before summary/helper sweep. Remove `resetHelperIndex` and its sole helper caller. No HTTP schema changes.

**Dead-code scope:** Trace project cache writes, gitIdentity callers, observer serial row loop, index pending/generation cleanup, resetHelperIndex exports/callers, and binding/detail forced lookup. Remove the superseded serial production loop and reset method; preserve injected single-item adapters used by supported tests.

**Review target:** Pane order independence, four-operation bound, no guessed worktree association, index failure/overlap races, duplicate transcript ambiguity, and fresh bound-helper proof.

- [ ] Add gated multi-pane fixtures and real Git main/worktree fixtures with worktree first; assert same grouping and maximum four active operations. Add counted cold traversals and overlapping forced-scan cases. Trace existing fallback callers.
- [ ] Run `bun --no-env-file test/observer-projects.test.js` and `bun --no-env-file test/observer-transcripts.test.js`; expect new order/concurrent-scan assertions to expose the old behavior. Record test-only cleanup as unchanged.
- [ ] Implement bounded discovery, ordered results, and scan generation/single-flight handling. Delete resetHelperIndex and old serial production loop only after updating callers.
- [ ] Run the two focused tests again; expect concurrency, uniqueness, symlink, replacement, and grouping assertions to pass. Search final references for removed APIs and partial-index publication.
- [ ] Run `bun --no-env-file test/observer.test.js` and `bun --no-env-file test/observer-helpers.test.js`; expect identity/footer/ancestry protections and default adapters to pass. Record cleanup findings and retained fixture compatibility.
- [ ] Fresh independent task review; record verdicts, focused evidence, cleanup, and residuals in FLOW.json.

### Task 3: Publish rooms early and warm bounded detail projections

**Goal:** Return room inventory before optional work, then prepare server-side detail projections without bypassing ownership checks.

**Execution:** Wave 3; sequential-only after Task 2 review. Own `sidecar/observer.js:refreshHerdr/refresh/get/inspect`, warm-detail adapter in `sidecar/observer-transcripts.js`, staged helper binding publication in `sidecar/observer-helpers.js:children/inspect`, lifecycle forwarding in `sidecar/presentation.js` and CLI creation in `server.js`. Tests: `test/observer.test.js`, `test/observer-transcripts.test.js`, `test/observer-ui.test.js`, `test/observer-inspector.test.js`, `test/presentation.test.js`.

**Read first/current-state evidence:** `get` awaits combined Herdr, desktop, helper, and bus refresh. `inspect` awaits `get` before pre/post footer and ancestry checks. Transcript `detailStates` already limits projections to 32 entries and 60 seconds, and validates file contents/path on every read. Browser `observer.js:resume/suspend` owns visibility and fresh resume proof; inspector closure deliberately drops its QuerySpine entry. Sprite initialization is already unawaited.

**Intended edits:** Split refresh into the core room commit and optional enrichment. Core awaits Herdr inventory, identity resolution, and project proof; it publishes base rows with `tool.available:false`, unavailable usage, and no fabricated helper state. Desktop inventory runs independently; it must not delay Herdr rooms. Return first `get()` after the core commit, while transcript summaries, helper discovery, desktop, and bus complete independently. Use captured generations to detect ownership changes, not as an unconditional rejection rule. An enrichment started before a later core refresh may publish for an unchanged exact identity only after comparing current source ownership, complete ancestry, and footer/process proof with its captured evidence. Reuse the existing inspection ownership/proof comparisons. Reject removed/replaced/reparented or unavailable owners; never overwrite current proofs or restamp captured source observation times. Preserve already-accepted enrichment across later core snapshots only while those same ownership checks hold. Publish accepted enrichment atomically with its corresponding helper binding map so visible helper rows and inspect bindings cannot describe different snapshots. Recompute aggregate from the published rows each commit. Preserve old observations on source failure with unavailable health. Until optional data is known, expose unavailable fields rather than zero usage or a fabricated available bus.

Keep one core refresh and one enrichment sweep in flight and coalesce the two-second demand refresh. Let in-flight work finish for unchanged owners across core generations; polling alone must not cancel or discard progress. Retain only the latest pending exact identity/ancestry target for changed owners, discard superseded queued targets, and reject completed obsolete ownership. No scheduler framework is needed. Explicit inspect requires current core ownership, never waits for unrelated optional work, and may use existing safe unavailable outcomes while a helper's latest binding is not ready. Do not serve an older helper binding as current merely because its parent survived.

After accepted enrichment publishes, including work started before a newer core refresh for unchanged ownership, enqueue eligible transcript-backed root/helper identities in stable roster order for detail warmup. Warm at most 32 identities per sweep with two concurrent jobs and one queued target per exact identity. A generation change alone does not replace queued work for an unchanged owner. Changed identities/ancestry replace their queued targets with only the latest target; check live row identity, source ownership, complete ancestry, and footer/process proof before each job. Use the existing `inspect(id, expectedIdentity)` path, including all pre/post proofs and file validation, to prepare projections. Successful results remain solely in transcript `detailStates`; discard returned bodies. Do not create a second response cache. Schedule each exact identity once per 60 seconds, prune scheduling records with retained roster IDs, and do not repeatedly retry an unavailable identity within that interval. Already-running explicit and warm reads share the transcript pending key. Clicking still performs fresh ownership/content validation and can fail unavailable after replacement, reparenting, expiry, or deletion.

`makeObserver({warmDetails:false})` disables preparation. CLI sets it for presentation; teardown prevents new jobs, discards late work, awaits bounded in-flight work, and closes SQLite resources. Browser behavior needs no new warmup network requests or timers: authenticated sessions polling triggers server preparation. A hidden page acquires no new browser work; already-started bounded server work may settle.

**Interfaces:** Add private `helpers.prepareChildren(parents)`, returning existing lineage fields plus synchronous `commitBindings(acceptedIds)` for its staged binding map. Observer validates captured ownership, filters accepted rows/annotations and complete ancestor chains, then installs those bindings and corresponding published rows together without an intervening await. Keep `children(parents)` as the existing immediate-commit adapter for supported direct callers. No rejected binding enters the live helper map. Public sessions and inspection routes/shapes stay unchanged. `get()` resolves a published core snapshot and triggers optional background completion. `close()` from Task 1 also stops enrichment/warmup. `warmDetails` defaults true for ordinary observer construction, false in presentation construction; tests can disable it or inject deferred adapters.

**Dead-code scope:** Trace refresh/get promise ownership, lastGood/aggregate/proof updates, retain eviction, helper binding publication, close callbacks, and presentation construction. Remove old all-sources barrier. Preserve inspector/browser cache invalidation and visibility handlers; no new frontend data ownership.

**Review target:** Early first rooms, snapshot immutability, partial-source truthfulness, core proof atomicity, helper lifecycle safety, bounded scheduling, no background presentation content, no HTTP identity shortcut.

- [ ] Add deferred transcript/desktop/helper/bus fixtures; require core rooms to resolve before their release. Add warmup counters and identity/reparent/removal races. Hold enrichment across at least three successive two-second core refreshes with unchanged proofs; release it and assert helper rows, matching inspect bindings, metadata, and warmup progress publish without false timestamp freshness. Repeat with changed identity/ancestor/process proof and require rejection. Inspect existing refresh and retain consumers.
- [ ] Run `bun --no-env-file test/observer.test.js`; expect new early-room and warmup assertions to fail. Keep existing stale/proof tests meaningful rather than rewriting them to accept weaker truthfulness.
- [ ] Implement generation-scoped core/enrichment commits and warmup through inspect. Remove the all-source wait and superseded refresh bookkeeping; wire warmDetails and close.
- [ ] Run `bun --no-env-file test/observer.test.js` and `bun --no-env-file test/observer-transcripts.test.js`; expect early publication, progress across repeated unchanged-owner refreshes, atomic helper bindings/rows, two-job/32-identity bounds, projection reuse, changed-owner late-write rejection, and fresh explicit validation to pass. Check final scheduler/retain reachability.
- [ ] Run `bun --no-env-file test/observer-ui.test.js`, `bun --no-env-file test/observer-inspector.test.js`, and `bun --no-env-file test/presentation.test.js`; expect hidden/resume behavior, close eviction, and presentation privacy to pass. Record why unchanged frontend lifecycle needs no removal.
- [ ] Fresh independent task review; record requirements/quality verdicts, final references, race evidence, and residuals in FLOW.json.

### Task 4: Revalidate public assets and verify integrated loading

**Goal:** Reuse public bytes safely across reloads and verify the full startup/inspection path.

**Execution:** Wave 4; sequential-only after Task 3 review. Own `server.js:createServer` static response branch, `frontend/js/assets.js:init`, and `test/server.test.js`. Integration verification uses existing observer/UI tests; create no benchmark framework or persistent logs containing private content.

**Read first/current-state evidence:** Server sets no-store on all responses, validates host/origin before dispatch, resolves static paths under frontend, and injects token/theme/nonce into observer.html. `assets.js:init` explicitly fetches the sprite manifest with cache no-store. Existing `test/server.test.js` checks script/frame availability, token/origin guards, and symlink confinement.

**Intended edits:** Apply `Cache-Control: private, no-cache` and content-derived ETag only to successful non-HTML static responses after authorization, containment, and file-read checks. Return 304 only on matching If-None-Match for that verified public byte content; on changed bytes return 200/new ETag. Keep every HTML response, API response, dynamic theme endpoint, error, and unknown route no-store, including conditional requests. Do not cache injected HTML or share browser caches across users. Retain no-cache revalidation rather than immutable caching because assets have stable filenames. Change only the manifest fetch cache option to permit normal revalidation; retain async sprite startup and existing fallback behavior. Preserve any incoming theme authorization/path rules before conditional responses.

**Interfaces:** Existing routes remain; static responses add ETag and conditional 304. No private API ETag or browser detail persistence.

**Dead-code scope:** Trace global no-store/static override, manifest fetch option, HTML aliases, MIME dispatch, theme routes, and early-return paths. Remove only the superseded static no-store override and explicit manifest no-store request; preserve the private default.

**Review target:** Cache scope, conditional authorization ordering, replacement invalidation, token/nonce privacy, and no new room/sprite startup barrier.

- [ ] Add HTTP assertions for static ETag/304, modified fixture bytes, HTML/API/error no-store, and unauthorized conditional requests. Trace each static/dynamic route before choosing eligibility.
- [ ] Run `bun --no-env-file test/server.test.js`; expect ETag/304 assertions to fail. Fixture creation/removal remains in existing test cleanup boundaries.
- [ ] Implement verified static conditional responses and manifest revalidation. Remove obsolete cache overrides only inside this ownership.
- [ ] Run `bun --no-env-file test/server.test.js`; expect route guards, token injection, all shipped assets, and caching assertions to pass. Search static conditional paths and removed no-store override references.
- [ ] Run `bun run test`; expect all installed tests to pass. Record Bun runtime/version and native SQLite evidence. With synthetic fixtures, record core-room completion before held enrichment, warm-versus-cold parser work, and unrelated HTTP completion during SQLite work. No fixed real-world speedup claim; live private/browser runs require explicit approval. Confirm no orphan workers, snapshot folders, or test fixtures after shutdown.
- [ ] Fresh independent task review and final aggregate branch review under executor; record tested scope, cleanup, residual limitations, and gate evidence in FLOW.json. Controller then handles approved delivery/PR workflow.
