"""v4 — adds end-buffer (0.30s) and start-buffer (0.10s) to keep word boundaries.

On top of v3:
- For each kept range [s, e], extend e -> e + 0.30 but never beyond half-the-gap to next keep.
- Extend s -> s - 0.10 similarly toward previous keep.
- This preserves trailing 's', breaths, and word ramp-ins without re-introducing dead air.
"""
import json
from pathlib import Path

W = Path('.work')
TOTAL = 527.183333

prev = json.loads((W/'cuts_v3.json').read_text())
keep = [list(k) for k in prev['keep']]

words = []
wj = json.loads((W/'source.json').read_text())
for seg in wj.get('segments', []):
    for w in seg.get('words', []) or []:
        words.append((float(w['start']), float(w['end']), w['word']))
words.sort()


def words_in(s, e):
    return [w for w in words if s <= w[0] < e]


END_BUF = 0.30
START_BUF = 0.10
MAX_GAP_FILL = 0.60   # if gap is small, allow filling more (avoid micro-cuts)

n = len(keep)
v4 = []
for i, (s, e) in enumerate(keep):
    # gap to next
    gap_next = (keep[i+1][0] - e) if i + 1 < n else (TOTAL - e)
    gap_prev = (s - keep[i-1][1]) if i > 0 else s

    # how far we can extend
    add_end = min(END_BUF, max(0, gap_next * 0.5))
    add_start = min(START_BUF, max(0, gap_prev * 0.5))

    # if the gap is very small, eat the whole gap with the buffer
    if gap_next < MAX_GAP_FILL:
        add_end = max(add_end, gap_next - 0.05)
    if gap_prev < MAX_GAP_FILL:
        add_start = max(add_start, gap_prev - 0.05)

    v4.append([round(s - add_start, 4), round(e + add_end, 4)])

# merge adjacent (within 0.05) keeps
v4.sort()
merged = [v4[0]] if v4 else []
for s, e in v4[1:]:
    if s <= merged[-1][1] + 0.05:
        merged[-1][1] = max(merged[-1][1], e)
    else:
        merged.append([s, e])

# bounds
merged = [[max(0, s), min(TOTAL, e)] for s, e in merged]

cuts = []
prev_e = 0.0
for s, e in merged:
    if s > prev_e + 0.05:
        cuts.append([prev_e, s])
    prev_e = e
if prev_e < TOTAL - 0.1:
    cuts.append([prev_e, TOTAL])

total_out = sum(e - s for s, e in merged)
saved = TOTAL - total_out

summary = {
    "total_in": round(TOTAL, 2),
    "total_out": round(total_out, 2),
    "saved": round(saved, 2),
    "saved_pct": round(saved / TOTAL * 100, 1),
    "n_keep": len(merged),
    "n_cuts": len(cuts),
}

# Build source -> cut mapping
mapping = []
cum = 0.0
for s, e in merged:
    mapping.append({"src_start": s, "src_end": e, "cut_start": cum})
    cum += (e - s)

(W/'cuts_v4.json').write_text(json.dumps({
    "keep": merged,
    "cuts": cuts,
    "mapping": mapping,
    "summary": summary,
}, indent=2))


def fmt(t):
    m = int(t // 60); s = t - m * 60
    return f"{m:02d}:{s:05.2f}"


with (W/'edl_v4.txt').open('w') as f:
    f.write("=== SmartCut v4 (with word-boundary buffers) ===\n")
    f.write(f"Source: {fmt(TOTAL)} ({TOTAL:.1f}s)\n")
    f.write(f"Output: {fmt(total_out)} ({total_out:.1f}s)\n")
    f.write(f"Saved:  {fmt(saved)} ({saved:.1f}s, {saved/TOTAL*100:.0f}%)\n")
    f.write(f"Kept: {len(merged)} | Cuts: {len(cuts)}\n\n")
    cum = 0.0
    for s, e in merged:
        snippet = " ".join(w[2].strip() for w in words_in(s, e))[:160]
        f.write(f"  src {fmt(s)}->{fmt(e)} ({e-s:5.1f}s) -> cut {fmt(cum)}-{fmt(cum + (e-s))}  | {snippet}\n")
        cum += (e - s)

print(json.dumps(summary, indent=2))


def src2cut(t):
    for m in mapping:
        if m['src_start'] <= t <= m['src_end']:
            return round(m['cut_start'] + (t - m['src_start']), 2)
    return None


# Resolve overlay anchors
anchors = {
    "OPEN_BADGE":      (0.5,    6.5,  "QUOTE_BADGE", "AI execs say:"),
    "QUOTE":           (2.7,    5.5,  "QUOTE_PULL",  '"Coding is virtually solved"'),
    "NAME_FIX":        (10.4,   6.5,  "NAME_FIX",    "Boris Cherny · Claude Code · Anthropic"),
    "BULLETS":         (60.5,   6.5,  "BULLETS_3",   "Brownfield · Multi-repo · Multi-tech"),
    "PRESENTATIONS":   (151.42, 11.0, "PRESENT_HERO","Presentations · Slides · Visuals"),  # Apple-style
    "BRAND_REVEAL":    (208.5,  4.5,  "BRAND_REVEAL","SpecWeave"),
    "TOOL_LOGOS":      (215.5,  5.5,  "TOOL_LOGOS",  "Claude Code · Codex · Copilot · Cursor"),
    "BIG_STAT":        (222.0,  7.5,  "BIG_STAT",    "10 apps · 3 months"),
    "TOOL_LOGOS2":     (367.0,  8.0,  "TOOL_LOGOS2", "GitHub · Jira · Azure DevOps"),
    "STATS_3":         (382.0,  8.5,  "STATS_3",     "600+ increments · 500+ NPM · 3000+ commits"),
    "CTA":             (393.0,  6.0,  "CTA",         "Build now — while we have this insane advantage"),
}

resolved = []
for name, (src_t, dur, kind, content) in anchors.items():
    cs = src2cut(src_t)
    if cs is None:
        print(f"# SKIPPED {name}: source {src_t:.2f}s is in a cut")
        continue
    resolved.append({"name": name, "start": cs, "duration": dur, "kind": kind, "text": content})

(W/'overlays_v4.json').write_text(json.dumps(resolved, indent=2))
print()
print("Overlay cut-times (v4):")
for r in resolved:
    m = int(r['start']//60); s = r['start']-m*60
    print(f"  {r['name']:18}  cut {m}:{s:05.2f}  ({r['duration']:.1f}s)  {r['text']}")
