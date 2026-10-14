<!-- GSD:project-start source:PROJECT.md -->

## Project

**Local Observer**

Local Observer is a standalone, read-only browser view of local Codex and Claude Code sessions. It displays repository groups, session status, available token usage, transcript inspectors, and llm-bus message couriers in an isometric pixel-art station. It serves developers observing agents running locally, primarily through Herdr on macOS.

**Core Value:** Show local agent activity truthfully without changing observed sessions or exposing private content beyond the local observation boundary.

### Constraints

- **Runtime:** Node.js 22.13+; native `node:sqlite` requires Node rather than substituting Bun. No npm package dependencies.
- **Platform:** macOS is the supported initial target. Python 3.11+, Git, and Herdr support source discovery. llm-bus and Xcode command-line tools enable optional integrations.
- **Privacy:** Loopback binding, per-launch API token, origin checks, bounded reads, identity checks, and redaction must remain intact. Presentation masking does not guarantee anonymity.
- **Truthfulness:** Missing sources remain unavailable and stale observations remain marked stale; unresolved identities must not open guessed transcripts.
- **Independence:** No StarNet checkout, account, cloud service, database server, or provider API key is required by the observer.
- **Verification:** `npm test` passed all 18 test files on Node v22.16.0 during initialization. This does not establish a fresh real-browser visual audit or live desktop integration check.

<!-- GSD:project-end -->

<!-- GSD:stack-start source:STACK.md -->

## Technology Stack

Technology stack not yet documented. Will populate after codebase mapping or first phase.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

These skills are local optional tooling, not versioned repository dependencies. Use them only when available.

| Skill | Description | Path |
|-------|-------------|------|
| accessibility-audit | "Check a live page against the barriers that actually lock people out — keyboard, contrast, labels, focus — each with the fix." | `.claude/skills/accessibility-audit/SKILL.md` |
| adversarial-review-pass | "Try to break the work, then try to refute your own finding, before reporting anything." | `.claude/skills/adversarial-review-pass/SKILL.md` |
| brand-assets | "Make images, covers and transparent cutouts that look like one family: a pinned style sheet, fixed formats, every file checked against it, and cutouts confirmed truly transparent." | `.claude/skills/brand-assets/SKILL.md` |
| frontend-design | "Give a web page or app its own look instead of a generic AI-made one: choose colors, type and layout on purpose before building, then critique the result. Use when building a new interface or reshaping an existing one." | `.claude/skills/frontend-design/SKILL.md` |
| spec-drafting | "Turn a fuzzy idea into something buildable — the smallest version that is genuinely useful, with acceptance criteria and the cuts named." | `.claude/skills/spec-drafting/SKILL.md` |
| web-app-qa | "Test a web app the way a real user would: click through the main flows, try odd inputs, watch for errors, and keep screenshots as proof. You get a bug report ranked by how serious each problem is." | `.claude/skills/web-app-qa/SKILL.md` |
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `$gsd-fast` for a trivial task inline, with no subagents and no PLAN.md
- `$gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `$gsd-debug` for investigation and bug fixing
- `$gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `$gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
