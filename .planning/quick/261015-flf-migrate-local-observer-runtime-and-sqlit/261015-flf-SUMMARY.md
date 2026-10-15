---
status: in_progress
---

# Bun migration

Approved revision2 registered verbatim. Both tasks complete and independently approved with no findings. Aggregate branch review of22files approved with no findings. PR #6 is open; remote PR review and merge pending.

Native bun:sqlite remains behind verified private snapshots. Installed Bun1.3.13 requires database-owned query() statements for immediate close; no adapter introduced. SQLite fixture groups now run unconditionally. Bun-only scripts/bin/help, native dotenv controls, child-process regression and active docs/runtime messages migrated. Zero package dependencies; Bun emits no lockfile for empty graph; npm lock removed.

Verification: bun run test passed all19testfiles including native SQLite/WAL and childenv; frozen install, CLI/package/executable/theme help, focused HTTP/VM security and diff-check passed on Bun1.3.13. No live desktop/browser or paid runs.
