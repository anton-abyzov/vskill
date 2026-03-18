# Tasks: 0569 Studio Error Handling

**Increment**: 0569-studio-error-handling
**TDD Mode**: STRICT — write the failing test FIRST, then implement

---

## US-001: Model Not Found Error Display

### T-001: Create shared ClassifiedError type with model_not_found
**User Story**: US-001 | **Satisfies ACs**: AC-US1-03, AC-US1-04
**Status**: [ ] Not Started
**Test**: Given `src/eval-ui/src/shared/classifiedError.ts` does not exist → When the file is created with a `ClassifiedError` interface whose `category` union includes `"model_not_found"` → Then `import { ClassifiedError } from "../shared/classifiedError"` resolves in TypeScript and `"model_not_found"` is assignable to `ClassifiedError["category"]`

---

### T-002: Add model_not_found to ErrorCard CATEGORY_CONFIG and re-export type
**User Story**: US-001 | **Satisfies ACs**: AC-US1-01, AC-US1-02, AC-US1-04
**Status**: [ ] Not Started
**Test**: Given an `ErrorCard` rendered with `error.category === "model_not_found"` → When the component mounts → Then the card renders with red color (`#ef4444` or `var(--red)`) and the hint text "The selected model is not available. Try switching to a different model in the dropdown above." is visible in the DOM; AND all existing consumers that import `ClassifiedError` from `ErrorCard.tsx` continue to compile without changes

---

## US-002: Retry Button Event Leak Fix

### T-003: Fix TestsPanel onRetry to not forward MouseEvent
**User Story**: US-002 | **Satisfies ACs**: AC-US2-01
**Status**: [ ] Not Started
**Test**: Given `TestsPanel` is rendered with a `generateEvalsError` in context → When the retry button inside `ErrorCard` is clicked → Then `handleGenerateEvals` is called with zero arguments (the callback spy receives no arguments, not a `MouseEvent`)

---

### T-004: Add runtime type guard in generateEvals for testType
**User Story**: US-002 | **Satisfies ACs**: AC-US2-02, AC-US2-03
**Status**: [x] Done
**Test**: Given `generateEvals` in `WorkspaceContext` is called with a non-string `testType` (e.g. a MouseEvent-like object) → When the function executes → Then `body.testType` is NOT set in the SSE call (treated as undefined) and no UI error is shown; AND when called with a valid string `"unit"`, `body.testType` equals `"unit"` in the outgoing request

---

## US-003: Safe SSE Serialization

### T-005: Implement safeStringify helper in sse.ts
**User Story**: US-003 | **Satisfies ACs**: AC-US3-01, AC-US3-02, AC-US3-03, AC-US3-04
**Status**: [x] completed
**Test**: Given a `safeStringify` helper at the top of `sse.ts` → When called with a circular-reference object → Then it returns a valid JSON string (non-throwing); AND when called with a DOM node-like object (non-plain object) → Then it returns a valid JSON string; AND when called with a plain serializable object `{ foo: "bar" }` → Then it returns the identical string that `JSON.stringify({ foo: "bar" })` would produce; AND when serialization cannot be recovered, `console.error` is called with the technical details

---

### T-006: Replace JSON.stringify calls in useSSE and useMultiSSE with safeStringify
**User Story**: US-003 | **Satisfies ACs**: AC-US3-03, AC-US3-04
**Status**: [x] completed
**Test**: Given `useSSE.start()` is called with a body containing a circular reference → When the hook attempts serialization → Then `fetch` is still called (not thrown) and `setError` receives "Failed to send request -- please try again" rather than crashing; AND `useMultiSSE.startCase()` exhibits the same behavior

---

## US-004: Workspace Error Banner Upgrade

### T-007: Create lightweight client-side error classifier
**User Story**: US-004 | **Satisfies ACs**: AC-US4-03
**Status**: [x] completed
**Test**: Given `classifyErrorClient(message: string)` in `src/eval-ui/src/shared/classifyErrorClient.ts` → When called with a string containing "rate limit" → Then it returns a `ClassifiedError` with `category === "rate_limit"`; AND a string with "401" or "unauthorized" → returns `category === "auth"`; AND a string with "timeout" → returns `category === "timeout"`; AND an unrecognized string → returns `category === "unknown"`

---

### T-008: Replace raw error banner in SkillWorkspace with ErrorCard
**User Story**: US-004 | **Satisfies ACs**: AC-US4-01, AC-US4-02
**Status**: [x] Done
**Test**: Given `SkillWorkspace` renders with `state.error = "Something failed"` → When the component mounts → Then an `ErrorCard` is rendered (not a raw `<div>` with inline red style); AND an `onDismiss` prop is wired so clicking the dismiss button dispatches `{ type: "SET_ERROR", error: null }` clearing the error

---

## US-005: React ErrorBoundary for Workspace

### T-009: Create ErrorBoundary class component
**User Story**: US-005 | **Satisfies ACs**: AC-US5-02, AC-US5-03, AC-US5-05
**Status**: [x] completed
**Test**: Given `ErrorBoundary` wraps a child component that throws during render → When the child throws → Then the fallback UI is shown containing the text "Something went wrong" and a "Reload" button; AND `console.error` is called with the error and component stack; AND clicking "Reload" calls `window.location.reload()`

---

### T-010: Wrap workspace panel content in ErrorBoundary keyed by skill
**User Story**: US-005 | **Satisfies ACs**: AC-US5-01, AC-US5-04
**Status**: [x] Done
**Test**: Given `SkillWorkspace` renders with `state.plugin = "pluginA"` and `state.skill = "skillA"` → When the `ErrorBoundary` key is set to `"pluginA/skillA"` and the skill changes to `"skillB"` → Then the `ErrorBoundary` receives a new key prop (`"pluginA/skillB"`) causing it to remount and reset error state; AND the `DetailHeader` and tab bar remain outside the boundary (still rendered when boundary shows fallback)

---

## Coverage Summary

| AC-ID | Covered By |
|---|---|
| AC-US1-01 | T-002 |
| AC-US1-02 | T-002 |
| AC-US1-03 | T-001 |
| AC-US1-04 | T-001, T-002 |
| AC-US2-01 | T-003 |
| AC-US2-02 | T-004 |
| AC-US2-03 | T-004 |
| AC-US3-01 | T-005, T-006 |
| AC-US3-02 | T-005 |
| AC-US3-03 | T-005, T-006 |
| AC-US3-04 | T-005, T-006 |
| AC-US4-01 | T-008 |
| AC-US4-02 | T-008 |
| AC-US4-03 | T-007 |
| AC-US5-01 | T-010 |
| AC-US5-02 | T-009 |
| AC-US5-03 | T-009 |
| AC-US5-04 | T-010 |
| AC-US5-05 | T-009 |
