---
increment: 0651-figma-connect-skill
title: "Figma Connect Skill - Combined MCP + CLI"
type: feature
priority: P1
status: active
created: 2026-03-30
structure: user-stories
test_mode: TDD
coverage_target: 90
---

# Feature: Figma Connect Skill - Combined MCP + CLI

## Overview

New vskill plugin skill combining Figma MCP server tools with Code Connect CLI for end-to-end design-to-code workflows.

## User Stories

### US-001: Skill Setup and Category Scaffold (P1)
**Project**: vskill

**As a** skill developer
**I want** a new "frontend" plugin category with a figma-connect skill
**So that** the skill is discoverable and distributable via vskill platform

**Acceptance Criteria**:
- [x] **AC-US1-01**: plugin.json exists with valid metadata
- [x] **AC-US1-02**: SKILL.md exists with valid frontmatter
- [x] **AC-US1-03**: SKILL.md under 500 lines with references

---

### US-002: Design-to-Code Workflow (P1)
**Project**: vskill

**As a** frontend developer
**I want** to implement UI components from Figma design URLs
**So that** I can translate designs to production code

**Acceptance Criteria**:
- [x] **AC-US2-01**: Parses standard, branch, Make URL formats
- [x] **AC-US2-02**: Checks existing Code Connect mappings
- [x] **AC-US2-03**: Uses get_design_context with framework params
- [x] **AC-US2-04**: Adapts code to project conventions

---

### US-003: Code Connect Publishing (P1)
**Project**: vskill

**As a** design system maintainer
**I want** to publish Code Connect mappings to Figma Dev Mode
**So that** developers see accurate code snippets

**Acceptance Criteria**:
- [x] **AC-US3-01**: Uses get_code_connect_suggestions
- [x] **AC-US3-02**: Generates .figma.tsx with prop mappings
- [x] **AC-US3-03**: Validates with CLI parse
- [x] **AC-US3-04**: Publishes via CLI and verifies
- [x] **AC-US3-05**: Supports dry-run mode

---

### US-004: Token Extraction (P2)
**Project**: vskill

**As a** frontend developer
**I want** to extract design tokens from Figma variables
**So that** design decisions sync to code

**Acceptance Criteria**:
- [x] **AC-US4-01**: Extracts via get_variable_defs
- [x] **AC-US4-02**: Detects token format
- [x] **AC-US4-03**: Organizes by category

---

### US-005: Eval Suite (P1)
**Project**: vskill

**As a** skill developer
**I want** comprehensive evals
**So that** skill quality is measurable

**Acceptance Criteria**:
- [x] **AC-US5-01**: 12 eval cases covering all modes
- [x] **AC-US5-02**: 3-5 assertions per case
- [x] **AC-US5-03**: 20 activation prompts (10/10)
- [x] **AC-US5-04**: Structural validation passes

---

### US-006: Framework Detection and Dual Auth (P1)
**Project**: vskill

**As a** developer
**I want** auto-detection and dual auth handling
**So that** setup is seamless

**Acceptance Criteria**:
- [x] **AC-US6-01**: Detects framework from project files
- [x] **AC-US6-02**: Checks MCP auth via whoami
- [x] **AC-US6-03**: Checks CLI auth
- [x] **AC-US6-04**: Error handling table complete
