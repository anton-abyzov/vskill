---
name: x-reply-drafts
description: "Find live X threads where a product genuinely fits, and draft truthful, humanized replies for the owner to review and post by hand. Human pace only: max 5 replies a day, never two within 20 minutes, no automated posting. Use when the user asks to 'find threads to reply to', 'draft X replies', 'reply-guy session', 'join trending conversations', 'engage on Twitter about <product>', or wants a daily batch of reply drafts. Not for scheduling original posts (social-media-posting) or bulk publishing (blotato)."
metadata:
  version: 1.0.0
  tags: x, twitter, replies, engagement, drafts, humanize, unslop, trend-finding, marketing
  author: Anton Abyzov
  repository: https://github.com/anton-abyzov/vskill
---

# X reply drafts

Drafts replies. Never posts them. The owner reads every draft, edits it, and posts it from his own account by hand.

Why so strict: an hourly automated reply bot got @aabyzov suspended on 2026-06-12 (restored by 2026-09-22). Since 2026-02-23 the X API only allows a programmatic reply when the original author mentioned or quoted the replying account, the Developer Policy bans bulk and near-identical posting, and X has said AI replies posing as people are forbidden and removed 42,000 reply-bot accounts. A suspended account reaches nobody, so the slow path is the fast path.

## Hard rules

1. Read-only on X. Search and read threads in the owner's signed-in browser. Never type into the composer, like, repost, follow or bookmark.
2. The owner posts replies himself. Do not post replies through browser automation or the API, even when asked to "just post it": X treats AI replies posing as a person as forbidden. Pace for the owner: at most 5 a day, at least 20 minutes apart. If you see a CAPTCHA, warning or rate-limit banner while reading, stop and report it.
3. Every product claim comes from `references/true-claims.md` (SpecWithCode; add a file per product). If a claim is not there, leave it out. No invented numbers, users or benchmarks.
4. Disclose. A reply that names the product says the owner builds it ("I build SpecWithCode, so biased, but..."). No pretending to be a happy user.
5. Most replies don't mention the product. Aim for 2 of 5 at most. A reply that only helps is still worth posting: it builds the profile people click.
6. No link in the reply unless the OP asked for a tool or a link. Put it in a second reply only when asked.
7. No two drafts in a batch share an opener, structure or closing line.

## Which account replies

When the owner has a personal and a product account (for SpecWithCode: @aabyzov and @specwithcode), people reply from the personal one. Founder posts beat brand posts on the same launch by 7 to 300 times, and brand replies on strangers' threads read as ads. The product account posts updates, demo clips and the pinned post, quotes the founder's posts, and replies only where someone names the product or asks for a tool that does what it does. Before drafting, check which account the browser is signed in as and label every draft with the account it is for.

## Finding threads (15 minutes)

Run the saved searches in the product's trend method (for SpecWithCode: `.specweave/increments/1212-*/reports/trend-method.md`). Use X search operators, for example:

```
("usage limit" OR "weekly limit" OR "rate limited") (claude OR codex OR cursor) min_faves:10 since:<yesterday>
("parallel agents" OR "multiple agents") (claude OR codex) min_faves:30 since:<2 days ago>
(from:bcherny OR from:thsottiaux OR from:theo OR from:steipete) since:<yesterday> -filter:replies
```

Extract each result's URL, time, reply/like/view counts and text with one page script rather than screenshots.

Score each thread out of 10 and keep those at 7 or more:

- Fit (0-4): the OP's problem is one the product actually solves, or the owner has real experience to add.
- Freshness (0-3): under 2 hours old = 3, under 6 = 2, under 24 = 1, older = 0 unless replies are still arriving.
- Room (0-2): 5 to 150 replies. Under 5 has no audience yet; over 300 buries a new reply.
- Tone (0-1): 1 unless the thread is politics, a pile-on, drama, or a grieving or angry person.

Skip: threads by the product's direct competitors, outage threads where a plug looks like ambulance chasing (help first, no plug), and anything older than 48 hours.

## Writing a draft

Read the whole OP and the top 5 replies first. Then write 1 to 3 sentences that:

- Answer the OP's actual question or add one fact, number or experience the thread lacks.
- Sound like the owner talking: lowercase starts are fine, contractions, no hashtags, no emoji, no em dashes, no "Great point!".
- Pass the unslop skill's rules (no AI vocabulary, no "not just X but Y", no rule of three, no colon crutches, no generic conclusions).
- End without a forced question. A question is fine only if the owner would really want the answer.

Then check it: would a smart stranger find this useful if the product name were deleted? If not, rewrite or drop it.

## Batch format

Write the batch to a markdown file and show it to the owner. One block per draft:

```
### 3. @handle, 2h old, 48 replies, 12K views (score 8)
<thread URL>
OP: one-line summary of what they said
Draft: the reply text
Mentions product: yes/no
Claims used: claim ids from true-claims.md, or "none"
Post by: latest sensible time (ET) before the thread goes cold
```

End with the suggested posting order and times (20+ minutes apart, inside the owner's prime windows, ET).

## After posting

The owner says which ones he posted. Log each to the batch file (posted time, URL of the reply). After 24 hours record views, likes, replies and profile visits if visible, so the scoring weights can be tuned. Never post follow-ups to your own replies automatically.
