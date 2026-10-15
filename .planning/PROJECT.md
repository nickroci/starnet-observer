# Local Observer

## What This Is

Local Observer is a standalone, read-only browser view of local Codex and Claude Code sessions. It displays repository groups, session status, available token usage, transcript inspectors, and llm-bus message couriers in an isometric pixel-art station. It serves developers observing agents running locally, primarily through Herdr on macOS.

## Core Value

Show local agent activity truthfully without changing observed sessions or exposing private content beyond the local observation boundary.

## Requirements

### Validated

Existing capabilities checked against source and the regression suite on 2026-10-14:

- Local, token-protected, read-only HTTP observation with origin and static-path confinement.
- Herdr session inventory, repository/worktree grouping, identity verification, and explicit stale/unavailable states.
- On-demand session and message inspectors with redaction and identity-bound reads.
- Optional llm-bus message metadata, couriers, and read-only inspectors.
- Isometric scene, crew animations, navigation, filtering, and FX controls.
- Presentation masking with stable fictional labels and disabled content inspectors.
- Strict JSON configuration, CLI precedence, interface color overrides, and basic/Helioforge presets.
- Optional macOS Codex desktop observation through the bundled Swift reader.

### Active

None. Initialization records the current application only; no feature milestone or implementation work is approved.

### Out of Scope

- Theme-pack runtime, custom crew artwork, theme picker, and Mama Insurance design: excluded from this initialization by the user.
- Agent launching, message sending, acknowledgments, session editing, and provider setup: the observer is read-only.
- Cloud hosting, public exposure, and remote model calls: this is a local companion application.
- New architecture mapping or ecosystem research: mapping was explicitly skipped; this initialization adds no future features.

## Context

- Package: `starnet-observer` version `0.1.0`, baseline commit `469babacefc7f898a85194cd3148da98ec9d73c2`.
- `server.js` owns HTTP bootstrap, API access controls, and frontend delivery.
- `sidecar/` owns configuration, source readers, identity, projects, inspectors, masking, and redaction.
- `frontend/` owns the browser interface, scene, model, and bundled sprite/font assets.
- `themes/` holds existing JSON configuration presets. Current color overrides do not replace scene geometry or crew artwork.
- `test/` and `scripts/test.js` provide the regression suite.
- `README.md` is the operational entry point. Historical theme handover files are separate proposals, not active requirements.
- GSD Core 1.16.0 is installed locally for Codex and Claude. Both clients share this `.planning/` state; downloaded tooling and personal workflow instructions remain local.

## Constraints

- **Runtime:** Bun 1.3.13+ with native `bun:sqlite`. No package dependencies or Node executable required.
- **Platform:** macOS is the supported initial target. Python 3.11+, Git, and Herdr support source discovery. llm-bus and Xcode command-line tools enable optional integrations.
- **Privacy:** Loopback binding, per-launch API token, origin checks, bounded reads, identity checks, and redaction must remain intact. Presentation masking does not guarantee anonymity.
- **Truthfulness:** Missing sources remain unavailable and stale observations remain marked stale; unresolved identities must not open guessed transcripts.
- **Independence:** No StarNet checkout, account, cloud service, database server, or provider API key is required by the observer.
- **Verification:** `bun run test` passed all 19 test files on Bun 1.3.13 on 2026-10-15, including mandatory native SQLite fixtures. Historical initialization evidence: `npm test` passed all 18 test files on Node v22.16.0. Neither run establishes a real-browser visual audit or live desktop integration check.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Record only the current app | Explicit user scope | Applied |
| Skip codebase mapping | Explicit user choice | Applied |
| Use saved GSD defaults | Explicit user choice: YOLO, balanced profile, parallel execution, tracked planning docs | Applied |
| Keep no active phases | No new work was requested | Applied |
| Use `@opengsd/gsd-core` for both clients | Explicit package choice | Installed locally |

## Evolution

Update this document when scope or verified behavior changes. A future milestone must state its requirements before generating implementation phases. Move newly verified requirements into Validated and retain explicit exclusions until the user changes them.

---
*Last updated: 2026-10-14 after baseline initialization*
