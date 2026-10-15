# Loading performance decisions

Approved technical revision3; Bun-only, native bun:sqlite, no runtime migration or new dependencies. All six optimizations accepted. Preserve exact identity/ancestry/footer/process proofs, redaction, bounded reads, source freshness, presentation privacy and theme integration. Database reset permitted if necessary; no reset needed and no external source mutation planned.

Private draft: .planning/drafts/loading-performance/PLAN.md

# Loading performance discovery

The user reports slow agent-detail opening and slow room loading. They requested background detail loading at startup and accepted all six proposed improvements: bounded warmup, earlier rooms, concurrent discovery, fewer directory scans, asynchronous SQLite work, and safe static caching.

This plan is for an implementer and for the user's approval decision. It creates no implementation branch, worktree, public API, private persistence, or GSD registration. Draft files are PLAN.md, DISCOVERY.md, and FLOW.json only. Controller must run simplicity review, self-review, independent design review, offer annotation, and obtain latest-plan approval before execution.

## Evidence and limits

| Topic | Source of truth | Finding |
| --- | --- | --- |
| Baseline | Git HEAD | `9f6a3f7cb5d32ae80ce6d7e0c7d27833c4beebaa` on main after Bun migration |
| Room barrier | `sidecar/observer.js:refreshHerdr/refresh/get` | Serial per-row transcript/project work; get awaits desktop/helper/bus as well |
| Identity safety | `sidecar/observer.js:inspect` | Pre/post footer validation, complete helper ancestry, concurrent roster ownership checks |
| Projection reuse | `sidecar/observer-transcripts.js:readFile/read` | 32 detail states, 60-second retention, pending deduplication, bounded content validation |
| Directory work | `sidecar/observer-transcripts.js:locate`; `observer-helpers.js:children` | TTL indices lack in-flight scan sharing; helper sweep clears all indices; explicit bound Codex reads force fresh uniqueness discovery |
| Project proof | `sidecar/observer-projects.js:resolve` | Linked grouping requires a single observed fresh main-checkout proof and revalidation |
| SQLite work | `sidecar/observer-bus.js:makePrivateSnapshotQuery/makeBusReader`; `observer-helpers.js:makeHelperObserver` | Synchronous private copies and native queries; bus already fingerprints unchanged sources |
| Browser lifecycle | `frontend/app/observer.js:resume/suspend`; `observer-inspector.js` | Hidden page stops subscriptions/frames; resume requires new proof; closing inspector drops browser cache intentionally |
| Asset loading | `frontend/js/assets.js:init`; `server.js:createServer` | Sprite loading already unawaited; manifest explicitly no-store; global response no-store includes public assets |
| Measurements | Controller investigation on existing port 4321 | Four-session API 2–3 ms, geometry 0.5–1.5 ms; reported lag was not reproduced |

## Decisions

Use four sequential tasks because observer, lifecycle, and server changes share contracts. One bounded worker moves only synchronous SQLite source work off HTTP; retain the existing source fingerprint and private-copy defenses. Keep all detail preparation in existing transcript caches and run existing inspection proofs rather than inventing a TTL response cache. Publish core rooms before optional enrichment. Accept work across core refreshes only while exact identity, complete ancestry, footer/process proof, and source ownership remain unchanged; generation changes alone must not starve progress. Install accepted helper bindings and visible rows atomically, retaining actual source timestamps. Revalidate stable public asset filenames with content ETags rather than immutable caching.

No new frontend body prefetch, geometry rewrite, sprite-loading rewrite, generic job framework, telemetry subsystem, worker pool, or database dependency is justified. Existing scene/sprite/cache work remains authoritative. Presentation disables private warmup; hidden browser lifecycle remains unchanged.

## Runtime clarification resolved

Latest user instructions replace earlier AGENTS and explicitly require Bun-only. Main and local config already use Bun 1.3.13+ and native bun:sqlite. Resumed cycle2 review approved unchanged technical revision3. No runtime migration or adapter is needed; use bun run test. Earlier runtime holds are historical audit evidence in FLOW.json.

## Clarification: cache reset permission

The user clarified “I wmant that if you ned to reset the db you can do it.” Treat this as permission to reset observer-owned derived state if required, not a requirement to hide stale rows or mutate external provider/bus databases. No reset is currently needed: detail projections are in memory and SQLite queries use disposable private copies. Preserve existing confirmed-disappearance removal and temporary-source stale behavior. This clarification adds no implementation feature.

Theme peers confirmed public asset validators must reflect mutable bytes, HTML bootstrap remains private, and startup layout/courier/view instances and theme warnings remain under theme ownership. The loading plan avoids frontend startup restructuring; preserve incoming theme routes and sprite readiness invalidation on integration.

## Coordination and authorization

Active peers include theme and Bun worktrees. Runtime migration has merged at the baseline; theme work may change server/theme routes and observer lifecycle. Controller sent a targeted ownership query before planned overlap. Recheck actual integration state before implementation; do not edit peers' checkouts. No source files have been edited by this planner. Paid or live private runs need explicit approval; synthetic fixtures and static source investigation are available without them.

## Review status and model controls

Planner used wnz-phase-executor and wnz-doc-write-expert. Host is Codex. Parent selected native gpt-6.1-sol with medium effort for this planner; same defaults apply to fresh implementers and independent reviewers. Controller's resolved model/effort are unavailable to this planner. No delegation, self-review, independent gate, implementation, commit, or GSD registration was performed here. Latest revision and audit status live in FLOW.json.

## Revision 3 design corrections

Independent R1 identified two requirement gaps in revision 2. Worker isolation loses the main thread's known-secret redaction source. Keep raw message inspection data bounded and private across IPC; apply one shared field/known-value sanitizer in the parent before display clipping. Do not transfer held secrets. Test an ordinary-shaped known-secret canary through the actual worker inspection path.

An unconditional generation check can discard every slow enrichment when core polling continues. Preserve progress for unchanged full ownership evidence, reject changed owners, publish helper bindings with accepted rows atomically, and retain only the latest pending changed-identity target. A deferred multi-refresh fixture must prove both progress and replacement rejection. These corrections reuse existing redaction and ownership rules; they add no runtime migration, response cache, or scheduling framework. Controller self-review and the latest independent gate remain pending in FLOW.json.
