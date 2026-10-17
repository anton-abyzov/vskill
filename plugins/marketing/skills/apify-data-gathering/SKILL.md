---
name: apify-data-gathering
description: "Get public web data the cheapest legal way, with Apify as the paid fetch layer: choose official API, plain fetch or an Apify Store actor, cap every run's spend, and save evidence. Activate when the user wants to scrape, crawl, extract, monitor or enrich data: lead lists from Google Maps or directories, contact emails from websites, social listening on X, Reddit, Instagram, TikTok or YouTube, Google SERP rank tracking, competitor site or pricing changes, review mining, job-post signals, or ingesting a docs site for RAG. Also when they mention Apify, actors, datasets, APIFY_TOKEN or mcp.apify.com."
metadata:
  version: 1.0.0
  author: Anton Abyzov
  category: marketing
  tags: apify, scraping, crawling, web-data, lead-generation, google-maps, social-listening, serp, reviews, enrichment, mcp
---

# Apify data gathering

Apify is a **fetch layer**: maintained scrapers (Actors), browsers, proxies and storage you pay for per result or per compute unit. It is not a strategy. This skill decides when Apify is the right door, keeps every run inside a budget, and leaves a dataset someone can audit.

The official [apify/agent-skills](https://github.com/apify/agent-skills) teach the platform (Actor catalogue, building Actors). This skill is the operating discipline around them: door choice, legality, budget, caching, evidence. Use both if both are installed.

## 1. Pick the door, cheapest first

| Tier | Door | Cost | Use when |
|---|---|---|---|
| 0 | Official API, export, RSS, sitemap, JSON-LD, the site's own XHR/GraphQL | $0 | Always check first. GitHub API, HN Algolia API, YouTube Data API, Reddit JSON, Google Places API, a league's JSON endpoint. |
| 1 | Plain fetch and parse (curl/httpx + selectors, or a single-page fetch tool) | $0 | Static HTML, a handful of pages, no bot wall. |
| 2 | Apify Store Actor | per result / per event | A maintained Actor exists for the site (Maps, Instagram, X, TikTok, Google SERP, reviews), or you need JS rendering or proxies at volume. |
| 3 | Generic crawler Actor (`apify/website-content-crawler`, `apify/cheerio-scraper`) or a custom Actor | compute units | Long-tail sites at volume, docs ingestion for RAG. |

Rules that override the table:

- For anything that runs on a schedule, compile a deterministic extractor once (selectors or a typed provider) and replay it. Do not call an LLM on every fetch; it creates drift and duplicates. Re-run the LLM only when health checks fail.
- Hash the fetched content and skip unchanged pages before paying for extraction.
- If the only way in is defeating a login, CAPTCHA, WAF challenge or honeypot aimed at you, stop and ask the user. Tooling being legal says nothing about the target allowing it.

## 2. Legal and data gate (before any run)

1. Read the target's terms and robots.txt. If the terms forbid automated access, say so and ask for an alternative (official API, partner export, written permission).
2. Public data only. Never use your own logged-in cookies with an Actor (LinkedIn, Facebook, Instagram private views). Logged-in scraping breaks those platforms' terms and risks the account.
3. Personal data: collect only business-contact fields the task needs, record the source URL for each row, and honour suppression lists. Cold email needs CAN-SPAM (US) or GDPR/PECR (UK/EU) compliance: opt-out, physical address, lawful basis.
4. Respect rate limits and honeypots: fetch only known URL shapes, no blind link following on sites that trap crawlers.

## 3. Token and network

- Token: `APIFY_TOKEN` env var, else macOS Keychain service `apify-api-token`. Read it into a variable, never echo, log, commit or paste it. If neither exists, stop and tell the user to create a token in Apify Console > Settings > API & Integrations and store it with `security add-generic-password -U -s apify-api-token -a "$USER" -w` (it prompts for the value).
- Network: `api.apify.com` must be reachable. Sandboxed or cloud agents often deny it; run on the user's machine or ask them to allowlist the host. Do not route around a network policy.
- MCP option: `https://mcp.apify.com` (OAuth, or `Authorization: Bearer`), narrow it with `?tools=actors,docs,<owner>/<actor>`. Good for exploring Actors interactively; use the script below for budgeted batch runs. Limit: 30 requests per second per user.

## 4. Budget every run

1. `python3 scripts/apify_run.py limits` shows month-to-date spend and the account cap.
2. Find the Actor and its pricing model: `python3 scripts/apify_run.py search "<site or task>"`, then open the Actor's Pricing tab. Prefer Actors with many users and recent updates.
3. Estimate before running: items x price per 1,000, plus compute for crawler Actors. Say the estimate out loud.
4. Smoke run with 10 to 20 items and a $0.25 to $1 cap. Inspect fields, then scale.
5. Every run passes `--max-usd` (maps to `maxTotalChargeUsd`) and, for pay-per-result Actors, `--max-items`. The script refuses a run without a cap and refuses one larger than the money left this month.
6. Reuse data: `--out` plus `--cache-hours` skips the run while the file is fresh. Dedupe on stable ids (place id, profile URL, post id), never on display text or dates.
7. The account-wide monthly cap lives in Console > Settings > Limits. Recommend one; do not change it yourself. Free plan: $5 a month, no rollover.

## 5. Run

```bash
cat > /tmp/maps-input.json <<'EOF'
{"searchStringsArray": ["indoor soccer"], "locationQuery": "Miami, FL", "maxCrawledPlacesPerSearch": 20, "language": "en"}
EOF
python3 scripts/apify_run.py run compass/crawler-google-places \
  --input /tmp/maps-input.json --max-usd 0.5 --max-items 20 \
  --out data/2026-10-17-maps-miami-indoor-soccer.json --cache-hours 24
```

The script starts the run asynchronously, polls until it ends, pages through the dataset (`clean=true`), writes a JSON array and prints `runId`, item count, `usageTotalUsd` and the Console URL. Exit codes: 2 no token, 3 over budget, 4 run did not succeed. Input fields differ per Actor: read the Actor's input schema first, never guess field names.

Synchronous shortcut for small jobs under 5 minutes: `POST /v2/acts/<owner>~<actor>/run-sync-get-dataset-items?maxTotalChargeUsd=0.5&maxItems=20` (408 after 300 s, so use the script for anything bigger).

## 6. Deliver

- Save raw output next to the work (`data/` or the increment's `reports/`), plus one manifest line per run: date, Actor, input file, runId, items, cost.
- Clean in a separate step: dedupe, normalise, drop fields the task does not need.
- Report counts, cost and the run link, and state what was not covered (blocked pages, missing emails).
- Never paste scraped personal data into public repos, issues or chats.

## References

- [references/recipes.md](references/recipes.md): step-by-step recipes (lead lists, social listening, SERP tracking, competitor monitoring, review mining, docs-to-RAG, news feeds with a daily cap).
- [references/actors.md](references/actors.md): Actors worth knowing, by job, with what to check before using each.
