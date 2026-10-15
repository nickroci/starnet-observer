---
status: in_progress
---

# Bun migration

Approved revision2 registered verbatim. Task1 implemented and independently approved with no findings (commit 8a3873e). Native bun:sqlite at private snapshot boundary, unconditional real fixtures and immediate close. Installed Bun1.3.13 requires database-owned query() statements for immediate close; prepare() delayed ownership was rejected by disposable probe.

Verification: both native SQLite scripts pass; full custom runner all18 files pass without SQLite skips; diff check clean. Controller independently repeated focused scripts. No live/paid integrations. Task2 implemented; independent review pending. Bun-only entrypoints/scripts and docs, native dotenv controls, focused child-process regression. All19 testfiles pass including mandatory SQLite; frozen install passes. Empty dependency graph produces no Bun lockfile, npm lock removed.
