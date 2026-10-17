# Actors worth knowing

Store IDs as of October 2026. Before any run: confirm the Actor still exists (`apify_run.py search`), read its input schema, and read its Pricing tab. Prices move and some Actors charge both per result and for compute.

## By job

| Job | Actor | Pricing shape | Check before use |
|---|---|---|---|
| Google Maps places (name, phone, website, category, rating) | `compass/crawler-google-places` | per place, add-ons cost extra | Turn off reviews, images and contact enrichment unless needed; each add-on is billed. |
| Google Maps, places only, cheaper | `compass/google-maps-extractor` | per place | No reviews or detail pages. |
| Google Maps reviews | `compass/google-maps-reviews-scraper` | per review | Cap reviews per place. |
| Emails, phones, socials from websites | `vdrmota/contact-info-scraper` | per page | Set `maxDepth` 1 to 2 and limit pages per domain; contact pages only. |
| Google SERP (organic, ads, People Also Ask) | `apify/google-search-scraper` | per results page | Pin `countryCode` and `languageCode`; one page is 10 results. |
| Any site to markdown or text (docs, blogs, RAG) | `apify/website-content-crawler` | compute units | Set `maxCrawlPages`, include and exclude globs; prefer the HTTP crawler type for static sites. |
| One-off "search and read the top pages" | `apify/rag-web-browser` | compute units | Good for agents; small `maxResults`. |
| Custom extraction, static HTML | `apify/cheerio-scraper` | compute units | Cheapest generic; no JavaScript. |
| Custom extraction, JS-rendered | `apify/web-scraper`, `apify/playwright-scraper` | compute units | Heavier memory; set `maxRequestsPerCrawl`. |
| Instagram posts, profiles, hashtags | `apify/instagram-scraper` (also `apify/instagram-profile-scraper`, `apify/instagram-post-scraper`) | per result | Public data only; `resultsLimit` per profile; old posts are billed again on every run, so pass a date cutoff. |
| X (Twitter) search and profiles | `apidojo/tweet-scraper` | per tweet | Use `maxItems`, `sort: Latest`, a since date; X changes often, so smoke test first. |
| Reddit posts and comments | `trudax/reddit-scraper-lite` | per result | Try Reddit's public `.json` endpoints first (tier 0). |
| TikTok videos and profiles | `clockworks/tiktok-scraper` | per result | `resultsPerPage` cap. |
| YouTube videos and channels | `streamers/youtube-scraper` | per result | YouTube Data API is free up to quota; use it first for stats. |
| YouTube comments | `streamers/youtube-comments-scraper` | per comment | Cap comments per video. |
| Facebook public pages and posts | `apify/facebook-pages-scraper`, `apify/facebook-posts-scraper` | per result | Public pages only; groups usually need login, so skip them. |
| Job posts (hiring signals) | search the Store for "linkedin jobs", "indeed" | per result | Public listings only; never log in. |
| B2B review sites (G2, Capterra, Trustpilot), app store reviews | search the Store by site name | per review | Pick Actors updated in the last 30 days; these sites change often. |

## Prefer free doors for these

- GitHub repos, stars, issues, releases: GitHub REST or GraphQL API.
- Hacker News: Algolia API (`hn.algolia.com/api/v1/search?query=...`).
- Reddit: append `.json` to a listing or search URL, with a descriptive User-Agent.
- YouTube statistics: YouTube Data API v3.
- npm downloads: `api.npmjs.org/downloads`.
- Sites with a sitemap, RSS or JSON-LD: parse those before crawling.

## Red flags in an Actor

- Asks for your cookies, session or password: do not use it.
- Few users, no update in months, many open issues: test with 5 items or pick another.
- "Unlimited" rental Actors: only worth it for steady high volume; check the monthly fee against pay-per-result.
