---
description: Next.js App Router i18n routing, RTL with CSS logical properties, and translation CI pipelines (Crowdin/Lokalise).
allowed-tools: Read, Write, Edit, Bash
model: opus
context: fork
---

# i18n

## Next.js App Router i18n ([locale] Segment Routing)

**Directory structure**:
```
app/
├── [locale]/
│   ├── layout.tsx
│   ├── page.tsx
│   └── dashboard/page.tsx
├── middleware.ts
└── i18n/
    ├── config.ts
    └── dictionaries.ts
```

**Config** (`i18n/config.ts`):
```typescript
export const i18nConfig = {
  defaultLocale: 'en',
  locales: ['en', 'de', 'fr', 'ar', 'ja'],
} as const;
export type Locale = (typeof i18nConfig.locales)[number];
```

**Middleware** (`middleware.ts`) -- detect locale, redirect bare paths:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { i18nConfig } from './i18n/config';

function getLocale(request: NextRequest): string {
  const cookieLocale = request.cookies.get('NEXT_LOCALE')?.value;
  if (cookieLocale && i18nConfig.locales.includes(cookieLocale as any)) return cookieLocale;

  const acceptLanguage = request.headers.get('accept-language');
  if (acceptLanguage) {
    const preferred = acceptLanguage.split(',')
      .map((lang) => lang.split(';')[0].trim().substring(0, 2))
      .find((lang) => i18nConfig.locales.includes(lang as any));
    if (preferred) return preferred;
  }
  return i18nConfig.defaultLocale;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith('/_next') || pathname.startsWith('/api') || pathname.includes('.')) return;

  const pathnameHasLocale = i18nConfig.locales.some(
    (locale) => pathname.startsWith(`/${locale}/`) || pathname === `/${locale}`
  );
  if (pathnameHasLocale) return;

  const locale = getLocale(request);
  return NextResponse.redirect(new URL(`/${locale}${pathname}`, request.url));
}

export const config = {
  matcher: ['/((?!_next|api|favicon.ico|robots.txt|sitemap.xml).*)'],
};
```

**Locale layout** (`app/[locale]/layout.tsx`):
```tsx
import { i18nConfig, type Locale } from '@/i18n/config';
import { notFound } from 'next/navigation';

export function generateStaticParams() {
  return i18nConfig.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children, params,
}: { children: React.ReactNode; params: Promise<{ locale: Locale }> }) {
  const { locale } = await params;
  if (!i18nConfig.locales.includes(locale)) notFound();
  const dir = locale === 'ar' ? 'rtl' : 'ltr';

  return (
    <html lang={locale} dir={dir}>
      <body>{children}</body>
    </html>
  );
}
```

## RTL Support with CSS Logical Properties

| Physical (avoid) | Logical (prefer) |
|---|---|
| `margin-left` / `margin-right` | `margin-inline-start` / `margin-inline-end` |
| `padding-left` / `padding-right` | `padding-inline-start` / `padding-inline-end` |
| `text-align: left` / `right` | `text-align: start` / `end` |
| `left: 0` / `right: 0` | `inset-inline-start: 0` / `inset-inline-end: 0` |
| `border-left` | `border-inline-start` |
| `width` / `height` | `inline-size` / `block-size` |

**Tailwind RTL plugin**:
```bash
npm install tailwindcss-rtl
```
```typescript
// tailwind.config.ts
import rtlPlugin from 'tailwindcss-rtl';
export default { plugins: [rtlPlugin] } satisfies Config;
```
Usage: `ps-4` (padding-inline-start), `pe-2` (padding-inline-end), `ms-2` / `me-4`, `text-start`.
Conditional: `ltr:pl-4 rtl:pr-4`. Tailwind v3.3+ has `ps`/`pe`/`ms`/`me` built-in (no plugin needed).

**Icon mirroring**: Mirror directional icons (arrows, chevrons) in RTL with `[dir='rtl'] .icon-directional { transform: scaleX(-1); }`. Do NOT mirror checkmarks, close, search.

## Translation CI Pipelines

**Crowdin** (GitHub Actions):
```yaml
name: Translation Sync
on:
  push:
    branches: [main]
    paths: ['public/locales/en/**']
  schedule:
    - cron: '0 6 * * 1'

jobs:
  upload-sources:
    runs-on: ubuntu-latest
    if: github.event_name == 'push'
    steps:
      - uses: actions/checkout@v4
      - uses: crowdin/github-action@v2
        with:
          upload_sources: true
          upload_translations: false
        env:
          CROWDIN_PROJECT_ID: ${{ secrets.CROWDIN_PROJECT_ID }}
          CROWDIN_PERSONAL_TOKEN: ${{ secrets.CROWDIN_API_TOKEN }}

  download-translations:
    runs-on: ubuntu-latest
    if: github.event_name == 'schedule'
    steps:
      - uses: actions/checkout@v4
      - uses: crowdin/github-action@v2
        with:
          download_translations: true
          create_pull_request: true
          pull_request_title: 'chore: update translations from Crowdin'
          pull_request_base_branch_name: main
        env:
          CROWDIN_PROJECT_ID: ${{ secrets.CROWDIN_PROJECT_ID }}
          CROWDIN_PERSONAL_TOKEN: ${{ secrets.CROWDIN_API_TOKEN }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**Lokalise**: Same pattern -- install CLI via `curl`, then `lokalise2 file upload --file "public/locales/en/common.json" --lang-iso en` and `lokalise2 file download --format json --directory-prefix "public/locales/%LANG_ISO%"`. Pass `--token` and `--project-id` from secrets.
