---
status: complete
---

# PR #11 synchronization

Merged published main d1388ec into PR #11, preserving remote hosts/relays and shipped provider choice, verified singleton, checkout identities, idle aging, theme packs and pixel styles. Fixed integration-only issues: duplicate Model import, remote checkout metadata loss and tests assuming flat session rows.

Bun 1.3.13: all 33 test files passed; theme validation and diff checks passed. Fresh independent integration review approved, with 13 focused test files passing and no new integration findings. No obsolete leftovers or new dependencies.

Known PR #11 defects remain outside this sync scope: healthy remotes can inherit unavailable local freshness, unavailable remote snapshots can appear live/empty, and the empty local-host spawn action sends rejected host:null. PR #11 remains open and is not approved for merge. No live SSH/provider actions were run.
