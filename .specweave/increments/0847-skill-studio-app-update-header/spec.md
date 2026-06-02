---
increment: 0847-skill-studio-app-update-header
title: "Skill Studio Header App Update Button"
type: feature
priority: P0
status: completed
created: 2026-05-21
---

# Skill Studio Header App Update Button

### US-001: Background App Update Detection
**Project**: vskill

**As a** Skill Studio desktop user
**I want** the app to check for desktop updates in the background
**So that** I see a clear update action without opening Preferences

**Acceptance Criteria**:
- [x] **AC-US1-01**: On desktop boot, Skill Studio checks for app updates when auto-check is enabled.
- [x] **AC-US1-02**: Available update state is shared between the existing toast and the header button.
- [x] **AC-US1-03**: Suppressed skipped/snoozed versions do not show the header button.

### US-002: One-Click Header Update
**Project**: vskill

**As a** Skill Studio desktop user
**I want** an Update button in the top header
**So that** one click downloads, installs, and restarts the app

**Acceptance Criteria**:
- [x] **AC-US2-01**: The top rail renders a compact clickable update button only when an app update is available.
- [x] **AC-US2-02**: Clicking the button downloads and installs the update using the existing desktop updater bridge.
- [x] **AC-US2-03**: After install completes, the same action calls the existing restart bridge.
- [x] **AC-US2-04**: Installing and restart errors remain visible and retryable.

### US-003: Regression Proof
**Project**: vskill

**As a** release owner
**I want** tests proving the header update path
**So that** app update notification UX does not silently regress

**Acceptance Criteria**:
- [x] **AC-US3-01**: Unit tests cover background check, header rendering, one-click install/restart, and error state.
- [x] **AC-US3-02**: The eval UI build passes.
