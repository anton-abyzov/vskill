# Spec: Studio Error Handling

**Increment**: 0569-studio-error-handling
**Project**: vskill
**Status**: draft

## Problem Statement

vSkill Studio has three bugs and one missing safety net that degrade the user experience when LLM operations fail:

1. **Bug: ClassifiedError type mismatch** -- The backend error classifier defines a `model_not_found` category, but the frontend `ErrorCard` component does not recognize it. When the backend returns this category, the UI falls back to a generic "unknown" error with no actionable hint.

2. **Bug: ErrorCard onClick event leak** -- In `TestsPanel.tsx`, `handleGenerateEvals` is passed directly as the `onRetry` callback. When the retry button fires, React passes a `MouseEvent` as the first argument, which lands in the `testType` parameter. This causes the SSE request body to contain a serialized MouseEvent object instead of a valid test type string.

3. **Bug: Unsafe JSON serialization in SSE layer** -- `useSSE` and `useMultiSSE` call `JSON.stringify(body)` without error handling. If the body contains non-serializable values (DOM objects from the event leak, circular references), `JSON.stringify` throws and the entire SSE call crashes with an unhandled exception.

4. **Missing: No React ErrorBoundary** -- If any component in the workspace panel tree throws during render, the entire application crashes to a white screen with no recovery path.

Additionally, the workspace-level error banner in `SkillWorkspace.tsx` renders raw error strings in a plain red div, while the rest of the app uses the structured `ErrorCard` component.

## User Stories

### US-001: Model Not Found Error Display

**Project**: vskill
**As a** skill developer
**I want** the UI to show a clear, actionable message when my selected model is not available
**So that** I know exactly what went wrong and how to fix it without guessing

**Acceptance Criteria**:
- [ ] **AC-US1-01**: When the backend classifies an error as `model_not_found`, the ErrorCard displays a distinct icon and color (not the generic "unknown" style)
- [ ] **AC-US1-02**: The ErrorCard hint text for `model_not_found` reads: "The selected model is not available. Try switching to a different model in the dropdown above."
- [ ] **AC-US1-03**: A shared `ClassifiedError` type definition exists on the frontend that includes `model_not_found` in its category union, matching the backend's canonical definition
- [ ] **AC-US1-04**: All existing ErrorCard consumers continue to work without import path changes after the type extraction

### US-002: Retry Button Event Leak Fix

**Project**: vskill
**As a** skill developer
**I want** the retry button on test generation errors to work correctly
**So that** clicking "Retry" re-runs test generation instead of sending corrupted data to the backend

**Acceptance Criteria**:
- [ ] **AC-US2-01**: Clicking the ErrorCard retry button in TestsPanel calls `handleGenerateEvals()` with no arguments (the MouseEvent is not forwarded)
- [x] **AC-US2-02**: The `generateEvals` function in WorkspaceContext silently ignores invalid `testType` values (non-string types are treated as undefined) -- no UI warning is shown
- [x] **AC-US2-03**: Valid string values for `testType` ("unit", "integration") continue to pass through to the backend unchanged

### US-003: Safe SSE Serialization

**Project**: vskill
**As a** skill developer
**I want** SSE requests to handle non-serializable body values gracefully
**So that** a serialization failure shows a user-friendly error instead of crashing the operation silently

**Acceptance Criteria**:
- [x] **AC-US3-01**: When `JSON.stringify` fails on the SSE request body (circular refs, DOM objects, class instances), the UI shows: "Failed to send request -- please try again"
- [x] **AC-US3-02**: The full technical error details (component names, stack traces, original value description) are logged to `console.error` only -- no internal details appear in the UI
- [x] **AC-US3-03**: Both `useSSE.start()` and `useMultiSSE.startCase()` use the safe serialization path
- [x] **AC-US3-04**: Normal serializable objects are serialized identically to the current behavior (no change to happy path payloads)

### US-004: Workspace Error Banner Upgrade

**Project**: vskill
**As a** skill developer
**I want** workspace-level errors displayed as structured ErrorCards instead of raw red banners
**So that** error presentation is consistent across the entire Studio UI

**Acceptance Criteria**:
- [x] **AC-US4-01**: The workspace error banner in `SkillWorkspace.tsx` renders an `ErrorCard` component instead of a raw `<div>` with inline error text
- [x] **AC-US4-02**: Workspace errors are dismissible (the ErrorCard includes a dismiss action that clears the error state)
- [x] **AC-US4-03**: A lightweight client-side error classifier maps common error patterns (rate limit, auth, timeout) to `ClassifiedError` objects; unrecognized patterns fall back to the `unknown` category

### US-005: React ErrorBoundary for Workspace

**Project**: vskill
**As a** skill developer
**I want** the workspace to recover gracefully from unexpected render crashes
**So that** a component failure shows a recovery UI instead of a white screen

**Acceptance Criteria**:
- [x] **AC-US5-01**: A React ErrorBoundary wraps the workspace panel content area (not the app root -- navigation and sidebar remain functional)
- [x] **AC-US5-02**: When a child component throws during render, the fallback UI shows a "Something went wrong" card with a "Reload" button -- no redirect occurs
- [x] **AC-US5-03**: The ErrorBoundary logs the error and component stack trace to `console.error`
- [x] **AC-US5-04**: Switching to a different skill resets the ErrorBoundary (the boundary instance is keyed by the current skill identifier)
- [x] **AC-US5-05**: The "Reload" button triggers a full page reload (`window.location.reload()`)

## Out of Scope

- Moving `ClassifiedError` to a shared monorepo package between eval-server and eval-ui
- Adding error telemetry or reporting infrastructure
- Refactoring error banners outside of SkillWorkspace (other pages are out of scope)
- Adding ErrorBoundary at the app root level
- Custom error recovery flows (retry-from-boundary, partial state restore)
