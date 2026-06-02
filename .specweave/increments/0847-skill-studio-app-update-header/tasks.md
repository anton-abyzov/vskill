---
increment: 0847-skill-studio-app-update-header
total_tasks: 4
completed_tasks: 4
---

# Tasks: Skill Studio Header App Update Button

### T-001: Share app updater state
**User Story**: US-001
**Satisfies ACs**: AC-US1-01, AC-US1-02, AC-US1-03
**Status**: [x] completed

**Test Plan** (BDD):
- Given auto-check is enabled -> When the app mounts -> Then the shared updater state checks once and records an available update.

### T-002: Add header update action
**User Story**: US-002
**Satisfies ACs**: AC-US2-01, AC-US2-02, AC-US2-03, AC-US2-04
**Status**: [x] completed

**Test Plan** (BDD):
- Given an app update is available -> When the user clicks the header Update button -> Then Skill Studio downloads, installs, and restarts through the desktop bridge.

### T-003: Preserve toast/details behavior
**User Story**: US-001, US-002
**Satisfies ACs**: AC-US1-02, AC-US2-04
**Status**: [x] completed

**Test Plan** (BDD):
- Given an app update is available -> When the toast renders -> Then Details still opens Preferences and errors remain visible.

### T-004: Verify regressions
**User Story**: US-003
**Satisfies ACs**: AC-US3-01, AC-US3-02
**Status**: [x] completed

**Test Plan** (BDD):
- Given the updated header updater flow -> When focused tests and the eval UI build run -> Then they pass.
