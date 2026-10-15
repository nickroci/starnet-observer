# PR4 mandatory fixes

User approved plan revision4 and PR4-before-theme ordering. Update existing nickroci/starnet-observer control-actions PR4, preserve contributor history, review then merge. Additions use a later delegated separate PR. Live launches not approved.

Decisions and short discovery

# PR4 planning discovery

## Provenance and agreed split

User requested two separately reviewable plans, mandatory PR4 merge readiness first, then additions. User approved planning only; no implementation approval or live-control approval. Decisions supplied from current discussion by controller: opt-in controls work in presentation; real pane IDs stay visible and are action targets; paths are masked in every response/error; fictional repo/session labels remain. Server validates current targets. Overseer identity comes from the launched pane and endpoint/workspace/provider/incarnation evidence, persists across observer restart, and never relies on name/title/statusline/config/transcript proof. Stale/reused/foreign/unproven targets remain unavailable. One overseer overall; provider selection never auto-stops one.

Mandatory plan owns detection with existing Claude launch, private controls, checkout-relative folder correctness, reviewed theme/loading integration and accurate docs. Additions owns explicit Codex/Claude overseer launch with equivalent initial AGENTS/CLAUDE briefs preserving edits, and visible checkout sections within repositories in station and Live sessions. Project '+' provider expansion excluded. Stable checkout identity, then subfolder; basenames never identity. Brief content requires independent review, user approval, then freeze.

Canonical semantic plans: .planning/drafts/pr4-merge-readiness/PLAN.md and .planning/drafts/pr4-additions/PLAN.md. This discovery records shared decisions once; additions DISCOVERY points here.

## Inspected facts

- PR4 current inspected head f423ded7c709fecfd74d9c643696931021cf1b33 changes 15 paths. Older reviewed 463dbcee is not the latest review scope.
- Shared checkout main 9f6a3f7 is stale; fetched origin/main 3dbf16a3062d42938d359f2d9e8a7fe646800dda contains merged loading PR7. Read source through `git show`; no branch switch or worktree created.
- Controller merge-tree evidence: PR4 versus origin/main conflicts README.md, server.js, sidecar/observer.js. Against theme 488278e additional observer-view.js, observer.js frontend and observer.css conflicts. Integration is not clean.
- Theme FLOW at .planning/drafts/observer-theme-foundation/FLOW.json remains active, awaiting explicit visual approval/content freeze; branch feat/observer-theme-foundation includes loading integration 488278e. Mandatory M1 waits for reviewed theme merge; never copies unfinished assets.
- `sidecar/control.js:overseer` uses agent name lookup; observer refresh classifies /^overseer/ names. `startIn` hardcodes Claude; only missing CLAUDE.md gets the existing initial brief.
- Presentation rowProjection maps real pane IDs to Terminal N and drops role; control responses bypass that projection and carry home/project/name or arbitrary errors. Server redaction is not path masking.
- PR4 resolver calculates folder from grouping main root after resolving a linked checkout. Current upstream resolver has bounded resolveMany and linked-first proof tests; preserve them.
- PR4 model section key contains repoId+folder, without checkout identity. Frontend caches row nodes by row.id; preserve these nodes/focus during grouping.
- Local Herdr help: `agent start <name> --kind KIND --pane ID`; valid kinds include claude and codex. `status server` exposes local socket path; current pane inventory exposes terminal_id/workspace_id/provider and sometimes agent_session. Schema supports these fields. No mutation command executed.
- Existing observer endpoint precedence is injected endpoint, HERDR_SOCKET_PATH, default local socket. Existing observer-identity uses terminal incarnation and optional config-dependent footer transcript fallback; the latter must remain outside overseer detection.
- origin/main package scripts use Bun and engine >=1.3.13; scripts/test.js discovers *.test.js and uses process.execPath. No implementation/test results claimed during planning.

## Proposed design, requiring plan gate/approval

Small private overseer state module with bounded private atomic record and exclusive launch reservation; native terminal incarnation is fallback when agent_session absent, missing terminal proof unavailable. Explicit one endpoint passed to read/control adapters. Control response allowlist rather than arbitrary-error path regex. Mandatory resolver correction keeps canonical checkout private. Additions A2 owns public opaque checkout identity and aliases alongside their first visual consumers; no unused public fields in mandatory merge work. One exclusive persisted reservation handles same-process and cross-process launch concurrency. Endpoint consistency preserves existing supported routing without adding speculative routing restrictions. These are proposals, not implemented facts.

## Workflow state

Fresh planner used wnz-phase-executor model-policy, engineering-quality and full implementation-plan-template. Requested/selected model gpt-6.1-sol medium; native resolved identity/effort unavailable. Draft only. Controller runs simplicity, then self-review and independent adversarial gate. No self-review or gate run by planner. Only PLAN.md, DISCOVERY.md, FLOW.json written per ticket. No GSD registration, branch changes, external messages, commits or live runs.

## Delivery amendment — revision3

User execution instruction: "after first plan push to existing PR and then merge after review, the secon plan you can work in a sub agnt and a separate PR". Execution approval covers these precise delivery amendments, subject to the fresh revision3 independent gate and unresolved theme ordering. Existing M1 theme-reviewed/merged dependency is unchanged until the user answers the pending ordering question. Prior planning-only statements above describe historical approval state.

Update existing PR4 on fork nickroci/starnet-observer, branch control-actions; maintainerCanModify=true was confirmed by controller. Use an owned local feature worktree from main, merge current PR head to retain contributor ancestry, re-fetch expected remote head before every fast-forward HEAD:control-actions push, never rewrite contributor commits or open a duplicate PR. Review then merge PR4 as explicitly requested.

## Order clarification — revision4

User answered "before": mandatory PR4 merges before unfinished theme work. This replaces the earlier theme-merge prerequisite and resolves that pending question. Use fresh origin/main (inspected 3dbf16a with loading PR7), never copy partial theme code/assets. Mandatory QA exercises shipped default; future theme compatibility is source/diff evidence and concrete follow-on integration notes. Theme controller owns later integration onto merged PR4; additions may execute after PR4 independently of theme, preserving any theme already merged in then-main. Existing delivery authorization remains: update/review/merge existing fork PR4; delegate additions into separate worktree/new review-ready PR, no second merge authorization. Revision4 independent gate remains PENDING.

## Final execution evidence

Revision4 was independently approved and implemented. Earlier planning-only/pending/theme-wait statements above are historical; revision4 controls. Mandatory tasks and two pushed PR review loops passed with no unresolved High/Medium issues. Full24file Bun suite passed after final source edits. PR #4 is the authorized delivery; additions follow its merge in a separate PR, with no second merge authorization. The final SUMMARY records verification limits and the Low observatory-helper visual residual.
