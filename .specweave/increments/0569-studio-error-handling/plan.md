# Architecture Plan: 0569 Studio Error Handling

## 1. Problem Statement

vSkill Studio has six interrelated error-handling defects that degrade the user experience when LLM operations fail. The bugs span the full stack from backend type definitions through SSE serialization to frontend React components. The fixes must be safe for all existing consumers since the affected components (ErrorCard, useSSE, ClassifiedError) are shared infrastructure.

## 2. Architecture Overview

```
eval-server/                          eval-ui/
+-----------------------+             +-------------------------------+
| error-classifier.ts   |             | shared/types.ts (NEW)         |
| ClassifiedError type  |----sync---->| ClassifiedError (canonical)   |
| (source of truth)     |             +-------------------------------+
+-----------------------+                    |
                                             v
                                 +---------------------------+
                                 | components/ErrorCard.tsx  |
                                 | - Re-exports type         |
                                 | - Consumes ClassifiedError|
                                 +---------------------------+
                                      |          |
                          +-----------+----------+----------+
                          |           |          |          |
                     TestsPanel  AiEditBar  SkillImprove CreateSkill
                          |
                     (onClick leak fix)

                                 +---------------------------+
                                 | sse.ts                    |
                                 | - Safe JSON serialization |
                                 +---------------------------+

                                 +---------------------------+
                                 | components/ErrorBoundary  |
                                 | (NEW - workspace-level)   |
                                 +---------------------------+
                                      wraps
                                 +---------------------------+
                                 | SkillWorkspace.tsx         |
                                 | - ErrorCard replaces       |
                                 |   raw error banner         |
                                 +---------------------------+
```

## 3. Component Design

### 3.1 ClassifiedError Type Sync

**Problem**: The `ClassifiedError` type is defined in two places with divergent categories. The backend (`error-classifier.ts`) has `model_not_found`; the frontend (`ErrorCard.tsx`) does not.

**Decision**: Extract a shared type definition file on the frontend side that mirrors the backend's canonical definition. The backend remains the source of truth.

**Design**:
- Create `src/eval-ui/src/shared/classifiedError.ts` containing only the `ClassifiedError` interface
- The category union includes all backend values: `"rate_limit" | "context_window" | "auth" | "timeout" | "model_not_found" | "provider_unavailable" | "parse_error" | "unknown"`
- `ErrorCard.tsx` re-exports from shared file (preserves all existing import paths)
- `CATEGORY_CONFIG` in ErrorCard gets a new `model_not_found` entry with a magnifying glass icon and red color
- All other consumers (`workspaceTypes.ts`, `WorkspaceContext.tsx`, `useCreateSkill.ts`, `SkillImprovePanel.tsx`, `RunPanel.tsx`) continue importing from `ErrorCard.tsx` -- zero import changes needed

**Rejected alternative**: A monorepo shared package between eval-server and eval-ui. Overhead not justified for a single interface; the eval-server and eval-ui are not published independently.

### 3.2 ErrorCard onClick Event Leak

**Problem**: In `TestsPanel.tsx` line 233, `onRetry={handleGenerateEvals}` passes `handleGenerateEvals` directly as the retry callback. When the retry button fires, React passes a `MouseEvent` as the first argument. `handleGenerateEvals` has signature `(testType?: "unit" | "integration") => void`, so the MouseEvent lands in `testType`. This flows to `generateEvals({ testType: MouseEvent })` which causes the SSE body to contain a serialized MouseEvent object instead of a string.

**Fix**: Wrap the callback: `onRetry={() => handleGenerateEvals()}`.

**Impact analysis** across all ErrorCard consumers:
| Consumer | onRetry callback | Has the bug? |
|---|---|---|
| TestsPanel | `handleGenerateEvals` (accepts optional param) | YES -- MouseEvent leaks |
| AiEditBar | `handleTryAgain` (no params) | No -- signature is `() => void` |
| SkillImprovePanel | `handleImprove` (no params) | No -- `() => void` |
| CreateSkillPage | `sk.handleGenerate` (no params) | No -- `() => void` |
| CreateSkillInline | `sk.handleGenerate` (no params) | No -- `() => void` |

Only `TestsPanel.tsx` is affected. The fix is a one-line change.

**Defense in depth**: Also add a runtime type guard in `WorkspaceContext.tsx`'s `generateEvals` to validate that `opts?.testType` is a string (or undefined) before passing to SSE. This catches any future callers that make the same mistake.

### 3.3 Safe JSON Serialization in sse.ts

**Problem**: `useSSE.start()` and `useMultiSSE.startCase()` both use `JSON.stringify(body)` directly. If `body` contains non-serializable values (DOM objects, circular refs, class instances), `JSON.stringify` throws, crashing the SSE call with an unhandled exception.

**Design**:
- Add a `safeStringify(value: unknown): string` helper at the top of `sse.ts`
- Uses a try/catch around `JSON.stringify`
- On failure, falls back to a replacer function that strips non-serializable values (functions, DOM nodes, symbols) and breaks circular references
- Replace both `JSON.stringify(body)` calls (line 29 in `useSSE`, line 128 in `useMultiSSE`) with `safeStringify(body)`
- On serialization failure after the replacer attempt, log a warning and send `{}` rather than crashing

**Why not in ErrorCard or callers**: The SSE layer is the last line of defense before network serialization. Fixing it here protects all current and future SSE consumers.

### 3.4 Workspace Error Banner Upgrade

**Problem**: `SkillWorkspace.tsx` lines 110-125 render a raw error string in a plain red banner. Other panels (TestsPanel, AiEditBar) already use the structured `ErrorCard` for classified errors, but the workspace-level banner has no classification, no retry action, and no hint text.

**Design**:
- Import `ErrorCard` and `classifyError` (a new thin client-side classifier that maps common error strings to ClassifiedError objects) into `SkillWorkspace.tsx`
- Replace the raw `<div>` banner with: if `state.error` is set, create a `ClassifiedError` via `classifyError(state.error)` and render `<ErrorCard error={classified} onDismiss={...} />`
- No onRetry needed for workspace-level errors (they are generic failures like delete errors); only dismiss is relevant
- The client-side `classifyError` function reuses the same pattern-matching logic from the backend `error-classifier.ts` but is a lightweight subset (rate_limit, auth, timeout, unknown only -- no provider-specific hints)

**Rejected alternative**: Pipe all backend errors through the SSE classified error channel. Too invasive; many errors come from REST endpoints (DELETE, GET) not SSE streams.

### 3.5 React ErrorBoundary

**Problem**: If any React component in the workspace tree throws during render, the entire app crashes with a white screen. There is no ErrorBoundary anywhere in the component tree.

**Design**:
- Create `src/eval-ui/src/components/ErrorBoundary.tsx` as a class component (required by React -- function components cannot be error boundaries)
- Props: `fallback?: ReactNode`, `onReset?: () => void`, `children: ReactNode`
- State: `{ hasError: boolean; error: Error | null }`
- `static getDerivedStateFromError(error)` captures the error
- `componentDidCatch(error, info)` logs to console.error with component stack
- Renders a recoverable fallback UI: error title, description, and a "Reload Workspace" button that calls `onReset` or `window.location.reload()`
- Wrap at workspace level in `SkillWorkspace.tsx`, around the panel content area (not at app root -- that would hide navigation)

**Placement rationale**: Wrapping at the workspace level means:
- Navigation/sidebar remain functional if the workspace crashes
- User can switch to a different skill to recover
- ErrorBoundary resets naturally when the `key` prop changes (skill switch = new boundary instance)

```tsx
// In SkillWorkspace.tsx
<ErrorBoundary key={`${state.plugin}/${state.skill}`}
               onReset={() => window.location.reload()}>
  <div className="flex-1 overflow-hidden">
    {/* panel content */}
  </div>
</ErrorBoundary>
```

### 3.6 generateEvals Runtime Type Guard

**Problem**: `generateEvals` in `WorkspaceContext.tsx` (line 500) accepts `opts?: { testType?: "unit" | "integration" }` but performs no runtime validation. If a non-string value leaks through (as with the MouseEvent bug), it silently passes invalid data to the backend.

**Design**:
- At the top of `generateEvals`, validate `opts?.testType`:
  ```ts
  if (opts?.testType && typeof opts.testType !== "string") {
    console.warn("generateEvals: invalid testType, ignoring", opts.testType);
    opts = undefined;
  }
  ```
- This is a defensive guard that catches the MouseEvent leak and any future caller mistakes
- Keep the existing function signature unchanged

## 4. File Change Map

| File | Change Type | Description |
|---|---|---|
| `src/eval-ui/src/shared/classifiedError.ts` | NEW | Canonical ClassifiedError interface with model_not_found |
| `src/eval-ui/src/components/ErrorCard.tsx` | MODIFY | Import from shared, add model_not_found to CATEGORY_CONFIG, re-export type |
| `src/eval-ui/src/pages/workspace/TestsPanel.tsx` | MODIFY | Fix `onRetry={() => handleGenerateEvals()}` (line 233) |
| `src/eval-ui/src/pages/workspace/WorkspaceContext.tsx` | MODIFY | Add runtime type guard in generateEvals |
| `src/eval-ui/src/sse.ts` | MODIFY | Add safeStringify helper, replace JSON.stringify calls |
| `src/eval-ui/src/components/ErrorBoundary.tsx` | NEW | React ErrorBoundary class component |
| `src/eval-ui/src/pages/workspace/SkillWorkspace.tsx` | MODIFY | Replace raw error banner with ErrorCard, wrap panels in ErrorBoundary |
| `src/eval-ui/src/shared/classifyErrorClient.ts` | NEW | Lightweight client-side error classifier |

## 5. Test Strategy

All changes follow TDD -- write the failing test first, then implement.

### 5.1 Unit Tests

| Test File | Tests |
|---|---|
| `src/eval-ui/src/shared/__tests__/classifiedError.test.ts` | Type compatibility: model_not_found is assignable to ClassifiedError |
| `src/eval-ui/src/components/__tests__/ErrorCard.test.tsx` | model_not_found renders correct icon/color; onClick does not pass event args to onRetry |
| `src/eval-ui/src/pages/workspace/__tests__/generateEvals-guard.test.ts` | generateEvals strips non-string testType values; valid strings pass through |
| `src/eval-ui/src/__tests__/sse-safeStringify.test.ts` | Handles circular refs, DOM nodes, functions, normal objects, undefined body |
| `src/eval-ui/src/components/__tests__/ErrorBoundary.test.tsx` | Catches render errors, shows fallback, resets on key change |
| `src/eval-ui/src/shared/__tests__/classifyErrorClient.test.ts` | Maps rate_limit, auth, timeout patterns; unknown fallback |
| `src/eval-server/error-classifier.test.ts` | model_not_found classification (new category); existing categories still match |

### 5.2 Integration Tests

| Scenario | Covered By |
|---|---|
| ErrorCard retry in TestsPanel does not leak MouseEvent | ErrorCard.test.tsx simulates click, verifies callback args |
| Workspace error banner renders ErrorCard with dismiss | SkillWorkspace rendering test |
| SSE body with non-serializable value does not crash | sse-safeStringify.test.ts with mock fetch |

## 6. Dependency Order

The implementation tasks must follow this order due to data flow dependencies:

```
T-001: shared/classifiedError.ts (type definition)
  |
  +---> T-002: ErrorCard.tsx (import shared type, add model_not_found)
  |       |
  |       +---> T-003: TestsPanel.tsx onClick fix
  |       |
  |       +---> T-005: SkillWorkspace.tsx (uses ErrorCard)
  |
  +---> T-004: WorkspaceContext.tsx (runtime guard)
  |
  +---> T-006: sse.ts (safeStringify, independent)

T-007: ErrorBoundary.tsx (independent of above)
  |
  +---> T-005: SkillWorkspace.tsx (wraps with ErrorBoundary)

T-008: error-classifier.test.ts (backend test, independent)
```

Parallelizable groups:
- Group A (can run in parallel): T-001 + T-006 + T-007 + T-008
- Group B (after T-001): T-002
- Group C (after T-002): T-003, T-004, T-005

## 7. Risk Analysis

| Risk | Likelihood | Mitigation |
|---|---|---|
| Re-export from ErrorCard breaks existing imports | Low | All consumers import from `../../components/ErrorCard` -- re-export preserves this path |
| safeStringify changes SSE payload shape | Low | Only activates on non-serializable values (which would crash today) |
| ErrorBoundary catches too broadly | Medium | Scoped to workspace panel content only; navigation/sidebar excluded |
| Client-side classifyErrorClient diverges from backend | Medium | Kept intentionally minimal (4 categories); backend classifier is source of truth for SSE errors |
| model_not_found config in ErrorCard missing icon | Low | Explicit entry added with fallback to unknown config |

## 8. Non-Goals

- Moving `ClassifiedError` to a true shared monorepo package (premature; single interface)
- Adding error telemetry/reporting (separate initiative)
- Refactoring all raw error banners across the app (only workspace-level banner in scope)
- Adding ErrorBoundary at the app root level (navigation must stay functional)
