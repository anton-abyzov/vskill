---
description: Playwright + axe-core integration for scoped audits, dynamic content testing, and custom rule configuration.
allowed-tools: Read, Write, Edit, Bash
model: opus
context: fork
---

# Accessibility Testing

## Playwright + axe-core Setup

```bash
npm install -D @axe-core/playwright axe-core
```

## Full Page Audit

```typescript
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('homepage has no WCAG 2.1 AA violations', async ({ page }) => {
  await page.goto('/');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});
```

## Scoped Audits (Testing Specific Components)

```typescript
// Audit only the navigation region
test('navigation is accessible', async ({ page }) => {
  await page.goto('/');
  const results = await new AxeBuilder({ page })
    .include('[role="navigation"]')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

// Exclude third-party widgets you cannot control
test('page accessible excluding third-party', async ({ page }) => {
  await page.goto('/');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .exclude('.third-party-widget')
    .analyze();
  expect(results.violations).toEqual([]);
});
```

## Dynamic Content Accessibility (Modals, Dropdowns, AJAX)

```typescript
// Test modal after interaction
test('modal is accessible after opening', async ({ page }) => {
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.waitForSelector('[role="dialog"]');

  const results = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

// Test after AJAX content loads
test('dynamic list is accessible after loading', async ({ page }) => {
  await page.goto('/search');
  await page.getByRole('searchbox').fill('test');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.waitForSelector('[data-testid="results"]');

  const results = await new AxeBuilder({ page })
    .include('[data-testid="results"]')
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(results.violations).toEqual([]);
});

// Focus trap: verify focus stays inside modal
test('modal traps focus within dialog', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open modal' }).click();
  await page.waitForSelector('[role="dialog"]');

  const focusableInModal = await page.locator('[role="dialog"]').locator(
    'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
  ).all();

  for (let i = 0; i < focusableInModal.length + 2; i++) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      return dialog?.contains(document.activeElement) ?? false;
    });
    expect(inside).toBe(true);
  }

  await page.keyboard.press('Escape');
  await expect(page.locator('[role="dialog"]')).not.toBeVisible();
});

// Live region announcements
test('status updates announced via live region', async ({ page }) => {
  await page.goto('/form');
  const liveRegion = page.locator('[aria-live="polite"], [role="status"]');
  await expect(liveRegion).toBeAttached();

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(liveRegion).toHaveText(/saved successfully/i);
});
```

## Custom axe Rule Configuration

```typescript
// Disable specific rules when justified (document why)
const results = await new AxeBuilder({ page })
  .withTags(['wcag2a', 'wcag2aa'])
  .disableRules(['color-contrast'])  // justified: brand colors approved by a11y team
  .options({ rules: { 'region': { enabled: true } } })
  .analyze();

// Detailed violation reporting for CI logs
if (results.violations.length > 0) {
  const report = results.violations.map((v) => ({
    rule: v.id,
    impact: v.impact,
    description: v.description,
    helpUrl: v.helpUrl,
    nodes: v.nodes.map((n) => ({
      html: n.html,
      target: n.target,
      failureSummary: n.failureSummary,
    })),
  }));
  console.error('A11y violations:', JSON.stringify(report, null, 2));
}
```

## CI Gate: Block on Critical/Serious Only

```typescript
const pages = ['/', '/login', '/dashboard', '/settings'];

for (const pagePath of pages) {
  test(`${pagePath} has no critical/serious a11y violations`, async ({ page }) => {
    await page.goto(pagePath);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();

    const critical = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious'
    );

    if (critical.length > 0) {
      console.error(`Violations on ${pagePath}:`, JSON.stringify(
        critical.map((v) => ({ rule: v.id, impact: v.impact, count: v.nodes.length })), null, 2
      ));
    }

    // Block on critical/serious; warn on moderate/minor
    expect(critical).toEqual([]);

    const moderate = results.violations.filter((v) => v.impact === 'moderate');
    if (moderate.length > 0) {
      console.warn(`Moderate on ${pagePath}:`, moderate.map((v) => v.id));
    }
  });
}
```

## Reusable A11y Fixture

```typescript
// fixtures/a11y.fixture.ts
import { test as base, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

export const test = base.extend<{
  a11y: {
    assertNoViolations: (opts?: { tags?: string[]; exclude?: string[] }) => Promise<void>;
    assertNoCritical: () => Promise<void>;
  };
}>({
  a11y: async ({ page }, use) => {
    await use({
      assertNoViolations: async (opts) => {
        let b = new AxeBuilder({ page }).withTags(opts?.tags ?? ['wcag2a', 'wcag2aa']);
        for (const s of opts?.exclude ?? []) b = b.exclude(s);
        expect((await b.analyze()).violations).toEqual([]);
      },
      assertNoCritical: async () => {
        const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
        expect(r.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
      },
    });
  },
});

// Usage:
// test('homepage is accessible', async ({ page, a11y }) => {
//   await page.goto('/');
//   await a11y.assertNoViolations();
// });
```

## axe-core Rule Tags Quick Reference

| Tag | Meaning |
|---|---|
| `wcag2a` / `wcag2aa` / `wcag2aaa` | WCAG 2.0 Levels |
| `wcag21aa` / `wcag22aa` | WCAG 2.1 / 2.2 Level AA |
| `best-practice` | Non-WCAG best practices |
