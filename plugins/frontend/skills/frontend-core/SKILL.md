---
description: Frontend developer for React 19 new APIs, modern CSS patterns, and image placeholder strategies.
---

# Frontend Development

## React 19 APIs

**`use()` hook** -- read promises and context in render (works in conditionals, unlike useContext):
```tsx
// Read a promise during render (Suspense handles loading)
function UserProfile({ userPromise }: { userPromise: Promise<User> }) {
  const user = use(userPromise);
  return <h1>{user.name}</h1>;
}

// Read context conditionally (replaces useContext)
function ThemeButton() {
  if (shouldUseTheme) {
    const theme = use(ThemeContext);
    return <button className={theme.buttonClass}>Click</button>;
  }
  return <button>Click</button>;
}
```

**`useActionState`** (replaces useFormState):
```tsx
function LoginForm() {
  const [state, formAction, isPending] = useActionState(loginAction, null);
  return (
    <form action={formAction}>
      <input name="email" />
      <button disabled={isPending}>Login</button>
      {state?.error && <p>{state.error}</p>}
    </form>
  );
}
```

**`useOptimistic`** for instant UI feedback:
```tsx
function TodoList({ todos }: { todos: Todo[] }) {
  const [optimisticTodos, addOptimisticTodo] = useOptimistic(
    todos,
    (state, newTodo: Todo) => [...state, { ...newTodo, pending: true }]
  );

  async function addTodo(formData: FormData) {
    const newTodo = { id: crypto.randomUUID(), title: formData.get('title') as string };
    addOptimisticTodo(newTodo);
    await saveTodoToServer(newTodo);
  }

  return (
    <form action={addTodo}>
      <input name="title" />
      <ul>
        {optimisticTodos.map(todo => (
          <li key={todo.id} style={{ opacity: todo.pending ? 0.5 : 1 }}>{todo.title}</li>
        ))}
      </ul>
    </form>
  );
}
```

**`ref` as prop** (no forwardRef needed in React 19):
```tsx
function Input({ ref, ...props }: { ref?: React.Ref<HTMLInputElement> }) {
  return <input ref={ref} {...props} />;
}
```

**React Compiler** (auto-memoization):
- Remove manual `useMemo`/`useCallback` used only for performance -- compiler handles it
- Keep `useMemo` when memo is semantic (e.g., stable dep for non-React API)
- Keep `useCallback` for non-React code that compares references
- Requirements: React 19, strict mode, no rule-of-hooks violations
- Compiler skips components it cannot prove safe -- no breakage, just no optimization
- Enable via `babel-plugin-react-compiler` or framework config (Next.js 15+, Vite)

## Modern CSS Patterns

**Container queries** -- responsive based on parent, not viewport:
```css
.card-container {
  container-type: inline-size;
  container-name: card;
}
@container card (min-width: 400px) {
  .card { flex-direction: row; }
}
```

**`@layer`** for cascade control:
```css
@layer reset, base, components, utilities;

@layer components {
  .btn { padding: 0.5rem 1rem; border-radius: 0.25rem; }
}
@layer utilities {
  .p-4 { padding: 1rem; }  /* always wins over components */
}
```

## Placeholder Image Strategies

- **Shimmer**: CSS animation skeleton (no external dependency, best for lists)
- **BlurHash**: Encode to ~20-30 char string server-side, decode client-side to blurred placeholder (npm: `blurhash`)
- **Dominant color**: Extract single hex from image at build time, use as `background-color` while loading
- Fallback URLs: Products `https://picsum.photos/seed/{slug}/600/400`, Avatars `https://i.pravatar.cc/150?u={id}`
