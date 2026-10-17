# Recipes

Each recipe lists the door order, a smoke-run cap and the stable id to dedupe on. Run every Apify step through `scripts/apify_run.py` with `--max-usd`.

## 1. Lead list from directories and Maps (local businesses, clubs, facilities)

1. Tier 0/1: pull association and league directories, sitemaps and member lists with plain fetch. They often publish websites and role emails directly.
2. Maps: `compass/crawler-google-places` with `searchStringsArray` (categories, e.g. "indoor soccer", "futsal", "sports complex") and `locationQuery` per metro. Smoke run 20 places, $0.50. Dedupe on `placeId`.
3. Contacts: feed the websites to `vdrmota/contact-info-scraper` (`maxDepth` 1, contact and about pages). Dedupe on lowercased email.
4. Diff against every suppression source (prior recipients, unsubscribes, CRM, sending tool block list) before anything is sent.
5. Keep `sourceUrl` per row. Verify emails with a verifier before sending; send small batches with a compliant footer.

## 2. Social listening (brand, product and competitor mentions)

1. Tier 0: HN Algolia, Reddit `.json` search, GitHub search, YouTube Data API.
2. Apify for what has no free door: `apidojo/tweet-scraper` (search terms, `sort: Latest`, since yesterday), `apify/instagram-scraper` (hashtags), `clockworks/tiktok-scraper`.
3. Daily cap per platform (for example $0.50) and a since date so old posts are not billed again. Dedupe on post id.
4. Output: one table of mention, author, URL, date, engagement; flag questions and complaints that deserve a reply. Draft replies; a human posts them.

## 3. SERP rank tracking (SEO)

1. `apify/google-search-scraper`, `queries` one keyword per line, `countryCode` and `languageCode` pinned, 1 to 2 pages.
2. Weekly cadence is enough. Store `keyword, date, position, url, title` and compare with last week.
3. Pair with Search Console data when available; SERP scraping shows competitors, Search Console shows your own clicks.

## 4. Competitor site and pricing monitoring

1. Tier 1: fetch the pricing, changelog and docs pages; hash the reduced text; stop if unchanged.
2. On change: `apify/website-content-crawler` limited to the changed section (include globs), then diff markdown.
3. Report what changed and why it matters (price, plan limits, new features), with the URL and date.

## 5. Review mining (positioning and feature gaps)

1. Store Actor for the review site (G2, Capterra, Trustpilot, app stores, Google Maps reviews).
2. Pull the last 12 months, cap 200 reviews per product. Dedupe on review id.
3. Cluster complaints and praise; quote with links. Use it for positioning, landing copy and roadmap, not for contacting reviewers.

## 6. Docs or site to markdown for RAG

1. Prefer the project's own repo or an `llms.txt`/sitemap.
2. Otherwise `apify/website-content-crawler`, `maxCrawlPages` capped, include globs on the docs path, HTTP crawler for static sites.
3. Store markdown with URL and crawl date; re-crawl only pages whose hash changed.

## 7. News feed for an organisation (club, league, partner), daily budget

1. Website: sitemap or RSS first, then a plain fetch of the news page, hashed.
2. Social: `apify/instagram-scraper` or `apify/facebook-posts-scraper` per profile with `resultsLimit` small and `onlyPostsNewerThan` set to the last successful run.
3. Hard daily cap per organisation (sum of `--max-usd`), stop when hit. Old results replayed by the Actor still bill, so the date cutoff matters more than dedupe.

## 8. Hiring and buying signals (B2B targeting)

1. Job listings mentioning the tools or roles you sell to (public listings only).
2. Group by company; enrich with the company site (tier 1) rather than people-scraping.
3. Output accounts, not people. Reach out through official channels.

## 9. Marketplace and catalogue discovery (skills, plugins, MCP servers, apps)

1. Official APIs, sitemaps or GitHub search first; most catalogues expose one.
2. Apify only for JS-rendered listings without an API, page-capped.
3. Dedupe on the canonical repo URL or package name; record the source catalogue per row.
