# Bun migration context

User approved revision 2 without notes on 2026-10-15. Two sequential tasks: native SQLite/mandatory fixtures; Bun runtime/toolchain/environment/messages/docs. Preserve CommonJS, compatible node APIs, private snapshots, bounded reads, identity, redaction, stale states and zero dependencies. Bun 1.3.13 baseline. No live or paid runs.

Discovery: Bun baseline passed 18 test files while skipping SQLite fixtures. Native macOS WAL shutdown and dotenv autoload need explicit controls. Use native APIs at existing boundaries; no compatibility adapter or framework conversion.

Private draft location: .planning/drafts/bun-migration (local, untracked). Approved plan is preserved verbatim in this folder. Registration only; execution and reviews use wnz-phase-executor.
