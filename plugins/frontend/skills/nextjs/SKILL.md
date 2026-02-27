---
description: Next.js caching layer interactions, Server Actions with useActionState, parallel and intercepting routes.
---

# Next.js

## Caching Layer Interactions

Three caching mechanisms that compose differently:

### fetch cache (Next.js Data Cache)
Controls HTTP-level caching for `fetch()` calls in Server Components:
```typescript
// Static (default in App Router) -- cached indefinitely
fetch('https://api.example.com/data');
fetch('https://api.example.com/data', { cache: 'force-cache' });

// SSR -- never cached
fetch('https://api.example.com/data', { cache: 'no-store' });

// ISR -- cached, revalidated on interval
fetch('https://api.example.com/data', { next: { revalidate: 3600 } });

// Tag-based -- cached until tag is invalidated
fetch('https://api.example.com/data', { next: { tags: ['posts'] } });
```
Invalidate with `revalidatePath('/posts')` or `revalidateTag('posts')` from Server Actions or Route Handlers.

### React.cache() (Request Deduplication)
Deduplicates identical calls **within a single server render**. Does NOT persist across requests:
```typescript
import { cache } from 'react';

// Called in multiple Server Components during the same render -- only 1 actual fetch
const getUser = cache(async (id: string) => {
  const res = await fetch(`/api/users/${id}`);
  return res.json();
});
```
Use for: expensive computations or data fetches called from multiple components in one render tree.

### unstable_cache (Cross-Request Cache)
Caches the **return value** of any async function across requests (not just fetch):
```typescript
import { unstable_cache } from 'next/cache';

const getCachedData = unstable_cache(
  async (id: string) => {
    return await db.query(`SELECT * FROM posts WHERE id = ?`, [id]);
  },
  ['post-by-id'],              // cache key segments
  { revalidate: 3600, tags: ['posts'] }  // options
);
```
Use for: database queries, third-party SDK calls, any non-fetch data source that needs caching.

### When to Use Each

| Data source | Mechanism | Persists across requests? |
|---|---|---|
| `fetch()` to external API | fetch cache (`next: { revalidate }`) | Yes |
| Same data needed in multiple components per render | `React.cache()` | No (single render) |
| Database query, SDK call, non-fetch | `unstable_cache` | Yes |
| Composition: DB call + dedup | `React.cache(unstable_cache(fn))` | Both |

## Server Actions with useActionState

```typescript
// app/posts/create/actions.ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

type State = { error?: string } | null;

export async function createPost(prevState: State, formData: FormData): Promise<State> {
  const title = formData.get('title') as string;
  const content = formData.get('content') as string;

  if (!title || !content) return { error: 'Title and content are required' };

  await db.post.create({ data: { title, content } });
  revalidatePath('/posts');
  redirect('/posts');
}
```

```tsx
// app/posts/create/page.tsx
'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { createPost } from './actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return <button disabled={pending}>{pending ? 'Creating...' : 'Create Post'}</button>;
}

export default function CreatePostPage() {
  const [state, formAction] = useActionState(createPost, null);

  return (
    <form action={formAction}>
      <input name="title" required />
      <textarea name="content" required />
      {state?.error && <p className="text-red-500">{state.error}</p>}
      <SubmitButton />
    </form>
  );
}
```

Key patterns:
- Server Action signature: `(prevState: State, formData: FormData) => Promise<State>`
- `useActionState` returns `[state, formAction, isPending]`
- `useFormStatus` must be in a child component of the `<form>` (not the same component)
- Call `revalidatePath` / `revalidateTag` before `redirect` to bust cache

## Parallel Routes (@folder)

Render multiple pages simultaneously in the same layout:
```
app/
├── @team/
│   ├── page.tsx          # rendered in layout's {team} slot
│   └── loading.tsx       # independent loading state
├── @analytics/
│   ├── page.tsx          # rendered in layout's {analytics} slot
│   └── default.tsx       # fallback when slot has no matching route
└── layout.tsx            # receives { team, analytics } as props
```

```tsx
// app/layout.tsx
export default function Layout({
  children, team, analytics,
}: { children: React.ReactNode; team: React.ReactNode; analytics: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2">
      <div>{team}</div>
      <div>{analytics}</div>
      <div className="col-span-2">{children}</div>
    </div>
  );
}
```

**`default.tsx`** is required for parallel route slots that may not match on initial load or hard navigation. It prevents 404 for unmatched slots.

## Intercepting Routes (..)

Intercept navigation to show a route in a different context (e.g., modal overlay):
```
app/
├── photos/
│   ├── [id]/
│   │   └── page.tsx        # full page view (direct URL or hard refresh)
│   └── (.)[id]/
│       └── page.tsx        # intercepted view (modal when navigating from /photos)
```

Convention prefixes:
- `(.)` -- intercept same level
- `(..)` -- intercept one level up
- `(..)(..)` -- intercept two levels up
- `(...)` -- intercept from app root

Common use case: photo grid links to `/photos/123`. Soft navigation shows modal (intercepted route). Hard refresh shows full page (non-intercepted route). Combine with parallel routes for modal slot.
