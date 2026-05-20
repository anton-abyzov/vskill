---
increment: 0846-skill-studio-install-flow
title: "Skill Studio Install Flow Reliability"
type: bugfix
priority: P0
status: active
created: 2026-05-20
---

# Skill Studio Install Flow Reliability

### US-001: Active Tool Preselection
**Project**: vskill

**As a** Skill Studio user
**I want** the install target modal to preselect my current tool
**So that** installing a skill does not require guessing between Codex CLI, OpenCode, Claude Code, and other targets

**Acceptance Criteria**:
- [x] **AC-US1-01**: Find Skills detail install modal receives the current active agent from App state.
- [x] **AC-US1-02**: Provider aliases such as `codex-cli` and `claude-cli` map to install target ids `codex` and `claude-code`.
- [x] **AC-US1-03**: If no active tool is known, the modal selects one detected filesystem target instead of opening with nothing selected.

### US-002: Install Completion UX
**Project**: vskill

**As a** Skill Studio user
**I want** the install window to close after a successful filesystem install
**So that** I return to the skills list and can verify the skill is installed

**Acceptance Criteria**:
- [x] **AC-US2-01**: Successful filesystem installs close the install target modal and refresh skills.
- [x] **AC-US2-02**: Error and clipboard-required installs keep the modal open with visible details.
- [x] **AC-US2-03**: Regression tests cover successful close and active-target preselection.
- [x] **AC-US2-04**: Successful multi-target installs update `vskill.lock` so install-state reports the selected scope as installed.

### US-003: End-to-End Proof
**Project**: vskill

**As a** release owner
**I want** recorded proof of Qmetry install from start to final installed search result
**So that** the shipped desktop build is verified against the reported failure

**Acceptance Criteria**:
- [x] **AC-US3-01**: Local install proof covers opening Find Skills, selecting Qmetry, installing, closing the modal, and finding it installed.
- [ ] **AC-US3-02**: Release is cut only after tests and proof pass.
