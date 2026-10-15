# Overseer Providers and Checkout Sections Implementation Plan

**Goal:** After mandatory PR4 fixes merge, let users launch one Codex or Claude overseer and distinguish checkouts in both station and Live sessions.

**Architecture:** Extend the mandatory overseer launch contract with an explicit provider enum. Keep one persistent identity record and one initial brief content source. Extend the existing resolver with verified checkout identity fields for nested frontend grouping; keep repository selection/ownership unchanged.

**Tech stack:** Bun >=1.3.13, CommonJS JavaScript, vanilla DOM/canvas, existing Git/Herdr adapters and tests.

## Global constraints

- Bun >=1.3.13, native `bun:sqlite`, no package dependencies or Node executable requirement.
- Keep loopback binding, launch token, origin checks, bounded reads, redaction, identity checks and stale-source semantics.
- Controls remain opt-in through `OBSERVER_CONTROL=1`; observation defaults read-only.
- Presentation keeps fictional project/repository/session labels and masks paths in every response and error. Real pane IDs stay visible and are action targets; no opaque target mapping.
- Verify current targets server-side. Missing, stale, foreign or reused identities become unavailable; never infer from names, titles or configuration.
- No paid runs or live attach/spawn/close/overseer launches without explicit user approval. Mock control processes for automated/browser checks.
- User approved execution with the delivery amendment recorded in DISCOVERY. Execution remains subject to a fresh independent gate for revision4. User clarified PR4 goes before unfinished theme work. Plannotator was declined; paid/live control approval and brief content approval remain separate.
- Fresh implementer per task; fresh leaf reviewer explicitly uses `wnz-code-reviewer` and `wnz-clean-code-js`. Requirement gaps and concrete High/Medium defect paths require fixes and fresh review. Record residuals and dead-code evidence in FLOW.json.
- DRY/KISS: reuse existing boundaries and tests; no registry framework, speculative provider layer or unrelated refactor. Consolidate startup retry duplication only when touching the same startup invariant.

- Execute only after pr4-merge-readiness merges and revision4 passes its fresh independent gate. User approved delegated execution in a separate feature worktree and a new separate PR. Stop at a review-ready PR; merging the second PR requires later explicit approval. Revalidate inherited interfaces against merged main before edits.
- One overseer overall across both providers. Changing the selector never stops, replaces or relabels a running overseer.
- Provider selection applies to overseer only. Keep project '+' Claude-only unless a concrete integration requirement forces a separately reviewed scope decision.
- Initial brief content has one shared source; existing `AGENTS.md` and `CLAUDE.md` user edits remain untouched, never forcibly synchronized.
- Same overarching repository group; distinct actual checkout identities, then subfolders. Basenames are labels, never identity keys.

## Acceptance criteria traceability

| Requirement | Task(s) | Verification |
| --- | --- | --- |
| User chooses Codex or Claude on overseer launch | A1 | Mock UI selection posts enum; exact Herdr --kind arguments |
| Shared one-overseer identity survives switch/rename/restart | A1 | Both-provider reload/concurrency/mismatch fixtures; no auto-stop |
| Equivalent initial AGENTS/CLAUDE briefs preserve edits | A1 | Byte equality on initial creation, existing edited files untouched, independent content review and user approval |
| Checkout boundaries visible in station and Live sessions | A2 | Main/two linked/same-basename/subfolder model and DOM tests; mock browser |
| Repository grouping/selection, stable rows, keyboard focus retained | A2 | Same repoId, separate checkout groups; DOM identity and focus across polls/filter |
| Paths remain masked and real pane IDs work | A1, A2 | Presentation HTTP/UI matrix with private sentinels and real pane requests |
| Current Bun/theme/loading retained | A1, A2 | `bun run test`, browser readiness/hide-resume/progressive arrival |

## Execution topology

| Wave | Tasks | Mode | Prerequisites | Isolation and integration | Wave verification |
| --- | --- | --- | --- | --- | --- |
| 1 | A1 | sequential-only | Mandatory plan merged; additions approved | New owned feature worktree from then-main | Provider/control/presentation/UI tests |
| 2 | A2 | sequential-only | A1 reviewed | Same worktree; shared observer/controller paths | Model/scene/view/UI and full suite |

- Parallel implementation permission: not-requested; shared controller, privacy projection and UI files require ordered integration.
- Host/model policy: Codex; planner, implementer/fixer and reviewer select `gpt-6.1-sol`, `medium`; actual resolved model/effort unavailable. No user override.
- Controller owns branch integration, FLOW and release records. A delegated controller/subagent owns this follow-up in its own feature worktree and new PR. Fresh task implementers and independent leaf code reviewers operate sequentially.

### Task A1: Add explicit overseer provider selection and equivalent initial briefs

**Goal:** Launch either supported provider deliberately, preserving the verified single-overseer contract.

**Execution:** Prerequisites: mandatory merge and A1-approved baseline. Wave1, sequential-only in new owned feature worktree. Controller re-fetches main and records baseline before dispatch; no modifications to other sessions' checkouts.

**Files:** Modify `sidecar/control.js:overseer,startIn,OVERSEER_BRIEF`, `server.js:createServer`, `frontend/app/observer.js:controlAction,observatory activation`, `frontend/css/observer.css` chooser styles, `README.md` optional controls. Test `test/control.test.js`, `test/control-ui.test.js`, `test/presentation.test.js`, `test/server.test.js`; retain mandatory `test/overseer-state.test.js`.

**Read first:** Merged mandatory `sidecar/overseer-state.js` and its tests; `sidecar/control.js:overseer,startIn`, `server.js` JSON body guard; frontend observatory activation/overlay focus conventions; `sidecar/config.js` and README current configuration conventions before adding any setting.

**Current-state evidence:** PR4 `startIn` hardcodes `--kind claude`; overseer writes only missing `CLAUDE.md`; browser confirmation hardcodes Claude. Herdr help lists Codex and Claude as valid kinds. Mandatory plan intentionally retains this existing launch default while replacing detection. Current initial brief addresses both provider ecosystems already.

**Intended edits:**

- Update `control.overseer(provider)` to require `'claude'|'codex'`. Route accepts `{provider}` with exact enum validation before any process/filesystem mutation. UI presents a labeled provider selector and explicit Start/Cancel using current focus/overlay conventions; default Claude preserves prior behavior. Visible confirmation names chosen provider.
- Thread provider only through overseer startup: exact `herdr agent start <name> --kind <provider> --pane <createdPane> --timeout 60000`. Keep current Claude args only for Claude; never pass them to Codex. Do not add new provider settings or bypass-permission flags. Project '+' remains unchanged.
- Reuse existing persistence, exclusive reservation and proof checks. Existing live overseer returns conflict with real paneId regardless of requested provider. Unknown/stale/corrupt identity remains unavailable. UI selector changes have no mutation side effects; no close/restart or provider switch action.
- Write missing `AGENTS.md` and `CLAUDE.md` from the same `OVERSEER_BRIEF` constant using exclusive create semantics. Existing contents, including divergent user edits, remain byte-for-byte untouched. Share initial content only; no background syncing or migration of edited files.
- Review brief as content independently; show exact shared initial content and obtain explicit user approval before freezing. Keep read-first/untrusted-peer/no-secret/no-permission-approval rules; content approval is separate from plan approval.
- Keep presentation result/error allowlist from mandatory plan; report provider through validated enum only if UI requires it. No raw home/cwd/name/errors. Preserve real pane IDs and role.

**Interfaces:** `POST /api/control/overseer` body `{provider:'claude'|'codex'}`; `makeControl().overseer(provider)`; unchanged `spawn(paneId)` and `row.role`. Private persistent record provider accepts the same enum. Initial file content remains `OVERSEER_BRIEF`; no second constant.

**Dead-code scope:** Trace hardcoded Claude overseer text/launch paths and replace only those; retain project '+' Claude wording. Consolidate retry loops only if provider threading touches both copies of the same startup invariant, retaining exact validation/retry behavior. Remove obsolete tests that only assert old provider-hardcoded behavior.

**Review target:** Validation before side effects, provider arguments and brief preservation, shared singleton detection, no unintended project-launch expansion, content approval and path-free presentation.

- [ ] **Step1:** Re-read merged mandatory contracts and characterize controls off/presentation on defaults. Add mock tests for both enums, invalid/missing provider, no close on selector change, existing other-provider overseer and corrupt record. Trace launch callers and brief creation paths.
- [ ] **Step2:** Run `bun --no-env-file test/control.test.js` and `test/control-ui.test.js` individually; expect hardcoded-provider/body/brief failures. No production cleanup yet.
- [ ] **Step3:** Implement enum threading, accessible chooser and exclusive missing-file creation. Remove obsolete overseer-only wording/branches after updating consumers.
- [ ] **Step4:** Run those files plus `test/server.test.js`, `test/presentation.test.js`, `test/overseer-state.test.js`; assert exact kind, no raw paths, unchanged existing briefs and one reservation. Recheck remaining callers/exports.
- [ ] **Step5:** Run `bun run test`; independent content review followed by user approval for initial brief before freeze. Browser mock confirms keyboard select/start/cancel/focus and no real launches. Record cleanup and retained project '+' path.
- [ ] **Step6:** Independent `wnz-code-reviewer` + `wnz-clean-code-js` task review; record both verdicts, commands, loop count and content approval in FLOW. Fix gaps/High/Medium before A2.

### Task A2: Add visible checkout boundaries in station and Live sessions

**Goal:** Separate main and linked checkout sections within their common repository, then retain subfolder sections and stable interactive rows.

**Execution:** A1 reviewed; wave2 sequential-only in same owned worktree. Own checkout identity projection, layout/model, scene/view rendering and Live sessions grouping; preserve mandatory action/transcript identity contracts.

**Files:** Modify `frontend/app/observer-model.js:sectionKey,sectionLabel,createLayout`, `frontend/app/observer-scene.js:build`, `frontend/app/observer-view.js` section signs/partitions, `frontend/app/observer.js:groupNode,rowNode` reconciliation/grouping, `frontend/css/observer.css` checkout headings/dividers; `sidecar/observer-projects.js`, `sidecar/observer.js` and `sidecar/presentation.js:rowProjection` for checkout identity propagation and aliases; `README.md` grouping explanation. Tests `test/{observer-projects,observer,observer-model,observer-scene,observer-view,observer-ui,presentation,control-ui}.test.js`.

**Read first:** Merged resolver private checkout/grouping-root distinction, public `worktree,folder` output and project fixtures; model `repoKey,sectionKey,createLayout.reconcile`, scene block metadata, view sign hit-testing; frontend `groupNodes,rowNodes,repoNodes` and focus-return logic; then-current main role/style conventions; inspect theme conventions only if already merged.

**Current-state evidence:** PR4 model groups sections by repoId plus folder only; worktree is a short basename. Live session DOM has one `session-list` per project, stable rowNodes keyed by id and repository toggle controls. Mandatory M3 fixes checkout-relative folder coordinates without adding unused checkout fields or UI. This task owns the public fields and their consumers together.

**Intended edits:**

- Add opaque `checkoutId` from the proven canonical actual checkout and `checkoutKind:'main'|'worktree'|'folder'` to the existing resolver output and inventory/presentation allowlists. Reuse existing opaque hashing, bounded discovery/cache and containment checks; no second discovery/cache or public path. Unknown checkout proof stays unavailable.
- Define section identity as tuple `(repoId,checkoutId,folder)` using collision-safe serialization, never display concatenation. Missing checkout proof groups under an explicit unavailable checkout label, never guesses a main or worktree by basename. Repository selection continues using repoId across every checkout.
- Carry `checkoutId`, `checkoutKind` and display label through existing block/scene section data. Render repository context plus `Main checkout` or `Worktree <label>` header and existing subfolder text; use a subtle divider/badge with text, not color alone. Preserve current geometry units and theme role contracts; use existing section partitions/sign machinery, no new scene system.
- Live sessions keeps overarching project/repository ownership and groups rows by checkout then folder. Reconcile keyed checkout containers and retain existing rowNodes/buttons/listeners; move nodes instead of recreating them. Keep repository toggles and counts correct under filters and source arrival/removal. Preserve focus when the focused node remains; use existing fallback when its row disappears.
- Extend the existing presentation alias maps with stable worktree aliases keyed by checkoutId and subfolder aliases keyed by checkoutId+folder. Main label stays generic. Never derive identity from aliases/basenames or expose absolute checkout/cwd paths. Both same-basename worktrees remain distinct.
- Update README grouping description after verified behavior. Add no cross-repo/worktree control expansion; action targets remain real pane IDs with server-side proof.

**Interfaces:** Extends existing inventory/projection with `checkoutId,checkoutKind`, then consumes `{repoId,checkoutId,checkoutKind,worktree,folder}` in the same task. Internal block/section metadata adds checkout fields while preserving `section.repo` for repo selection/sign hit regions. Row identity remains `row.id` across refresh/filter/reordering.

**Dead-code scope:** Replace repo+folder-only section keys and flat-only list reconciliation; trace section consumers, hit regions, selection, row focus and CSS selectors. Remove unused flat grouping helpers/styles only after verifying no theme/inspector consumer. Preserve stable allocation algorithm and upstream loading registration.

**Review target:** Same repo across distinct checkouts, folder coordinates, same-basename/symlink identity, privacy, focus/DOM stability, theme geometry, progressive arriving/removing sessions and repo toggle semantics.

- [ ] **Step1:** Add fixtures for main+two equal-basename linked checkouts with same subfolder, unavailable checkout and presentation aliases. Assert shared repo group, distinct checkout section keys, expected headings, exact existing row DOM objects and preserved focus after polling. Trace old key/list consumers.
- [ ] **Step2:** Run `bun --no-env-file test/observer-model.test.js` and `test/observer-ui.test.js`; expect merged checkout sections and absent headings failures. No runtime cleanup yet.
- [ ] **Step3:** Implement resolver/projection fields and aliases, tuple keys and nested keyed containers with existing partitions/styles; update scene metadata and remove confirmed unused flat-only helpers.
- [ ] **Step4:** Run model/UI tests plus `test/observer-projects.test.js`, `test/observer.test.js`, `test/observer-scene.test.js`, `test/observer-view.test.js`, `test/presentation.test.js`, `test/control-ui.test.js`; assert stable allocation/focus and private sentinel absence. Trace final exports/selectors.
- [ ] **Step5:** Run `bun run test`; mock browser station/Live sessions default (plus any approved theme already merged into then-current main), narrow viewport, keyboard navigation, loading/hide-resume, same-basename checkouts, filter/reorder/removal, presentation with controls. No live control launch; capture evidence. Verify final cleanup and documentation accuracy.
- [ ] **Step6:** Fresh independent task then aggregate review; PR review/fix loop, local and configured CI checks. Record requirements/quality verdicts and residuals. Create a new separate PR after mandatory PR4 merges. After task/aggregate/PR review loops and checks pass, update GSD summary/state and FLOW with the review-ready PR and hand off. Stop before merge: this instruction authorizes a separate PR, not its merge. Leave FLOW active at step11, with merge/GSD completion pending later explicit merge approval; do not claim merged completion.

## Theme order and later integration

A1/A2 depend on mandatory PR4 merge, not theme merge. Start from then-current main; preserve theme contracts if theme has merged by then. If theme remains unfinished, implement and verify shipped default only, with source/diff interface notes for the theme owner. Theme controller owns later integration onto merged PR4 and any subsequently merged additions; additions controller owns its separate PR conflicts against then-main. Shared hotspots: observer controller/view/CSS, server/observer composition and README. Do not import unfinished assets or delay additions on theme approval.
