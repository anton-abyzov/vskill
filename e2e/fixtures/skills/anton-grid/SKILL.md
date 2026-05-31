---
name: anton-grid
description: "Generate responsive CSS grid layouts from a column/gap spec."
version: "1.0.0"
allowed-tools: Read,Write
model: claude-sonnet-4-5
---

# anton-grid

A small CSS-grid helper skill. Turns a plain-language layout request into a
ready-to-paste `display: grid` block with sensible responsive defaults.

## Workflow

1. Read the requested column count and gap.
2. Emit a `.grid` rule with `grid-template-columns: repeat(N, minmax(0, 1fr))`.
3. Add a mobile breakpoint that collapses to a single column.

## Example

```css
.grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

@media (max-width: 640px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
```
