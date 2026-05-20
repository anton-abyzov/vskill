---
increment: 0846-skill-studio-install-flow
total_tasks: 6
completed_tasks: 5
---

# Tasks: Skill Studio Install Flow Reliability

### T-001: Pass active agent into Find Skills install modal
**User Story**: US-001
**Satisfies ACs**: AC-US1-01, AC-US1-02
**Status**: [x] completed

**Test Plan** (BDD):
- Given active agent is Codex CLI -> When the user opens install targets -> Then Codex CLI is selected by default.

### T-002: Add robust fallback selection
**User Story**: US-001
**Satisfies ACs**: AC-US1-03
**Status**: [x] completed

**Test Plan** (BDD):
- Given no active agent is persisted -> When the modal loads supported agents -> Then a detected filesystem agent is selected.

### T-003: Close successful filesystem install flows
**User Story**: US-002
**Satisfies ACs**: AC-US2-01, AC-US2-02
**Status**: [x] completed

**Test Plan** (BDD):
- Given an install completes without errors or clipboard exports -> When the success callback fires -> Then the modal closes and skills refresh.

### T-004: Persist multi-target install state
**User Story**: US-002
**Satisfies ACs**: AC-US2-04
**Status**: [x] completed

**Test Plan** (BDD):
- Given a multi-target filesystem install succeeds -> When install-state is fetched -> Then the matching scope reports the skill as installed.

### T-005: Run focused regression tests
**User Story**: US-002
**Satisfies ACs**: AC-US2-03
**Status**: [x] completed

**Test Plan** (BDD):
- Given the modified install UI -> When focused Vitest tests run -> Then they pass.

### T-006: Record install proof and release
**User Story**: US-003
**Satisfies ACs**: AC-US3-01, AC-US3-02
**Status**: [ ] pending

**Test Plan** (BDD):
- Given a fresh local project -> When Qmetry is installed -> Then the proof video shows the installed result before release.
