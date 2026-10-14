# Requirements: Local Observer

**Defined:** 2026-10-14
**Core Value:** Show local agent activity truthfully without changing observed sessions or exposing private content beyond the local observation boundary.

## Existing Baseline

These describe current supported behavior, not newly planned work. Evidence: current source and `npm test`, all 18 test files passing on 2026-10-14.

- [x] **OBS-01**: Users can inspect local session inventory grouped by repository and worktree, with explicit stale and unavailable states.
- [x] **OBS-02**: Users can inspect proven sessions on demand, with redacted content and protection against identity replacement.
- [x] **MAIL-01**: Users can observe optional llm-bus traffic and inspect identity-bound messages without sending or acknowledging mail.
- [x] **VIEW-01**: Users can navigate the isometric scene and use session selection, filters, token summaries, and FX controls.
- [x] **PRIV-01**: Users access the local API through loopback, origin checks, and a per-launch token; non-GET requests are rejected.
- [x] **PRIV-02**: Users can enable fictional labels while session and message content inspectors remain disabled.
- [x] **CONF-01**: Users can select validated JSON presets and CLI overrides for presentation labels, interface colors, and FX.
- [x] **DESK-01**: Users can optionally observe the Codex macOS desktop through the bundled Swift reader when platform permissions are available.

The regression suite verifies these contracts through fixtures and runtime/HTTP tests. It does not substitute for a new real-browser visual audit or live desktop permission check.

## Active Requirements

None. The user requested current app state only.

## Deferred Requirements

None approved. Theme proposals in the separate handover are not adopted into GSD by this initialization.

## Out of Scope

| Work | Reason |
|------|--------|
| Theme packs and Mama Insurance implementation | User explicitly selected current app state only |
| New features, research, or architecture mapping | No new milestone; mapping explicitly skipped |
| Agent or mailbox mutation | Observer remains read-only |
| Cloud exposure or provider integration | Existing app is local and independent |

## Traceability

Existing baseline requirements map to the existing implementation, not invented historical phases. There are zero active requirements and zero phases requiring mapping.

---
*Last updated: 2026-10-14 after baseline initialization*
