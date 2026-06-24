# US Finance Blog Automation — Architecture Review + Fix + Codex Build Plan

---

## 1. Gaps Found in Original Architecture

### A. Fact-Grounding (biggest risk)
- "Fact Verification" step is vague — "verify dates/limits/tax brackets" but **how**? Letting the same LLM that wrote the draft also "double-check itself" is weak. AI checking AI hallucination has a high miss rate.
- No structured **facts table** — numbers live only inside generated article text. There's no source of truth to verify against.
- Fix: Facts must be extracted from .gov sources **first**, stored in DB, and the draft-generation step must be **RAG-grounded** (only allowed to cite numbers that exist in the facts table). Verification becomes a deterministic match, not a vibe check.

### B. E-E-A-T / Compliance
- No author/reviewer entity. Fully anonymous AI content scores very low on Experience + Expertise for YMYL. Even with manual review, Google needs a visible byline + credentials (even pseudonymous, like Maya Quinn) + a real named human reviewer disclosed on the page ("Reviewed by [name]").
- No editorial policy page, no disclaimer ("not financial advice"), no About/Trust page — all required for finance E-E-A-T.
- No mechanism for **content freshness**. Tax brackets, COLA %, contribution limits change yearly — an article published in 2026 silently goes wrong in 2027 with nothing flagging it.

### C. SEO Technical (missing entirely)
- No schema markup (Article, FAQPage, Author, Breadcrumb) — finance content needs this for rich results.
- No topical cluster/pillar structure — topics table is flat. SEO authority needs pillar → cluster linking (e.g. Retirement pillar → 401k, Roth IRA, Social Security, Medicare).
- No internal linking automation.
- No sitemap/GSC ping on publish.

### D. Engineering Gaps
- Architecture says "Node.js Web App" but doesn't separate **admin dashboard** (internal, auth-gated) from **public site** (SEO-facing, needs SSG/ISR for speed + crawlability). These have different rendering needs.
- review_queue has no revision loop — binary approve/reject only. No `revision_notes`, no resend-to-draft-gen path.
- No dedup check on incoming topics — Reddit + Trends + News will generate the same topic multiple times/week.
- No plagiarism/originality check before publish.
- No cost guardrails — daily automation hitting OpenAI with no budget cap can spiral.

### E. Ops/Legal
- Reddit API: free tier explicitly bars commercial use **regardless of request volume** — paid commercial tier runs ~$12K/year (verified current pricing). This isn't a "low usage = cheap" situation, it's a ToS classification issue. The `reddit.com/r/X/.rss` workaround still technically loads but Reddit's own developer guidance flags it as rate-limited and "for testing purpose" only — same restriction, just a fragile path. Dropped from the automated pipeline (see Section 4).
- No RLS / access control defined on Supabase — who can write to review_queue? Admin auth is undefined.
- No article versioning — editing a published article (e.g. updating a tax year) leaves no audit trail.

---

## 2. Fixed Architecture

```
Next.js Web App (TypeScript)
   ├── Public Site (SSG/ISR)         — SEO-facing blog
   └── Admin Dashboard (auth-gated)  — review/ops console
                │
                ▼
            Supabase (DB + Auth + Storage, RLS enforced)
                │
                ▼
      Automation Engine (scheduled workers)
                │
                ├── Topic Discovery (Trends / Gov RSS / News)
                ├── Dedup Check (embedding similarity vs existing topics)
                ├── AI Topic Filter (evergreen / US / beginner / low-comp)
                ├── Keyword Expansion
                ├── Research Collection (.gov / .edu allowlist only) → Facts Table
                ├── Outline Generation
                ├── Draft Generation (RAG-grounded on Facts Table, citations stored)
                ├── Prose Refinement Pass (Gemini — anti-cliché, rhythm, readability)
                ├── Fact Verification Layer (deterministic claim↔fact match)
                ├── Originality/Plagiarism Check
                ├── Internal Link Suggestion (via cluster_id)
                └── Review Queue (with revision loop)
                         │
                         ▼
                  Manual Review (human + named reviewer)
                         │
                         ▼
            Schema Markup + Sitemap Generation
                         │
                         ▼
                      Publish
                         │
                         ▼
        Content Refresh Scheduler (fact.expires_year cron → re-flag stale articles)
```

---

## 3. Updated Database Schema

Keep your original `topics`, `research`, `articles`, `review_queue` — add/modify these:

```sql
-- topics gains:
topics ( ..., source TEXT DEFAULT 'auto' )
-- 'trends' / 'gov_rss' / 'google_news_rss' / 'manual' — lets the admin Topics tab
-- (Phase 6) filter by where an idea came from, and flags manually-added topics
-- (e.g. something you found browsing Reddit yourself) to skip the AI Topic Filter
```

```sql
-- NEW: ground truth facts, sourced only from .gov/.edu
facts (
  id, topic_id, fact_key,         -- e.g. "2026_401k_contribution_limit"
  fact_value, source_url, source_name,  -- IRS / SSA / CFPB / Treasury
  verified_date, expires_year     -- triggers refresh cycle
)

-- NEW: links every numeric claim in an article to the fact it came from
article_facts (
  id, article_id, fact_id, claim_text
)

-- NEW: topical authority structure
clusters (
  id, pillar_title, pillar_slug, category
)
-- topics gets: cluster_id FK

-- NEW: author/reviewer identity for E-E-A-T
authors (
  id, name, bio, credentials, avatar_url, is_real_reviewer BOOLEAN
)
-- articles gets: author_id, reviewed_by (FK authors), reviewed_at

-- MODIFIED: review_queue gains a revision loop
review_queue (
  id, article_id, review_status, reviewed_by, reviewed_at,
  revision_notes, rejected_reason, revision_count
)

-- NEW: staleness tracking
content_refresh_log (
  id, article_id, fact_id, flagged_at, resolved_at
)

-- NEW: cost guardrails
cost_tracking (
  id, run_type, tokens_used, cost_usd, created_at
)
```

---

## 4. Recommended Stack (flagging this — wasn't specified in original doc)

- **Frontend + Admin:** Next.js 14 App Router + TypeScript (SSG/ISR for public pages → SEO speed; auth-gated routes for admin)
- **DB/Auth/Storage:** Supabase, RLS on — public read only on `status = 'published'`, admin role required for writes
- **Automation triggers:** GitHub Actions scheduled workflows (cron) hitting internal API routes — cheaper/simpler than a standalone Node daemon
- **AI:** Hybrid OpenAI + Gemini — keep OpenAI where output quality directly drives ranking/revenue, use Gemini (free tier) where it's structural/redundant work. Not a blind cost-cut — the split is designed so Gemini's free tier actually improves the fact-safety architecture (dual-extraction cross-check, multi-vendor verification) rather than just saving money.

### Model assignment

| Step | Model | Why |
|---|---|---|
| AI Topic Filter (Phase 2) | Gemini (free) | Low-stakes yes/no classification |
| Keyword expansion (Phase 3) | Gemini (free) | Structural, no reader-facing prose |
| **Fact extraction (Phase 3)** | **OpenAI + Gemini, dual-run** | Most safety-critical step — errors here propagate silently downstream. Both models extract independently from the same source text; only matching values auto-accept into `facts`, mismatches go to manual fact-review |
| Outline generation (Phase 4) | Gemini (free) | Structural, low stakes |
| **Draft generation (Phase 4)** | **OpenAI (paid)** | The actual reader-facing prose — this is what drives ranking + AdSense RPM, worth paying for |
| Verification second-pass (Phase 5/11) | Gemini (free) | Different model family than the drafter = catches different blind spots, at zero added cost |
| Alt-text generation (Phase 12) | Gemini (free) | Low-stakes, structured |
| Multi-format outputs (Phase 14) | Gemini for YouTube script/Shorts/newsletter/Twitter thread, OpenAI for the primary blog_article | Only the canonical article needs top-tier prose; derivative formats are lower individual stakes |
| Embeddings (dedup/cannibalization) | Gemini or OpenAI, either works | Both cheap/free at this volume, doesn't matter much |

Net effect: OpenAI spend is limited to the one step that actually needs it (draft prose) — everything else runs free, and the free tier is used in a way that *adds* a safety layer (dual fact-extraction, multi-model verification) instead of just cutting cost.

---

## 5. Phased Build — Codex Prompts

Paste each phase into Codex sequentially. Each is scoped to be independently buildable/testable.

### Phase 1 — Foundation & Database
```
Build a Next.js 14 (App Router, TypeScript) project for a finance content automation system.
Set up Supabase client (server + client). Implement admin-only auth (Supabase Auth, magic link).
Write full SQL migrations for these tables: topics, research, articles, review_queue, facts,
article_facts, clusters, authors, content_refresh_log, cost_tracking (schema as specified below).
Apply RLS: public anon role can SELECT only from articles where status='published';
all other operations require an authenticated admin role.
[paste schema from Section 3 + original topics/research/articles/review_queue fields]
Output: working Next.js app with Supabase connected, migrations applied, admin login working.
```

### Phase 2 — Topic Discovery Engine
```
Build a scheduled job (triggered via API route, runs daily) that:
1. Parses RSS feeds from: irs.gov, ssa.gov, consumerfinance.gov, treasury.gov, dol.gov,
   medicare.gov (government press releases / news pages — find each agency's public RSS
   endpoint or news page and parse it). These surface real policy/rule changes early.
2. Fetches trending finance queries via an unofficial Google Trends library (pytrends or
   equivalent).
3. Fetches finance news via Google News RSS (free, unlimited, no commercial-use
   restriction — e.g. news.google.com/rss/search?q=<finance keyword>&hl=en-US&gl=US).
   Do NOT use NewsAPI.org's free Developer plan — it's explicitly restricted to
   development/testing only, production use requires their $449/month Business tier.
   Same trap as Reddit, just less well-known.
4. Do NOT integrate Reddit's API — free tier bars commercial use regardless of volume,
   paid tier is ~$12K/year. Skip this source entirely for the automated pipeline.
5. Normalizes results into a common shape {keyword, source, raw_text, category}.
6. Before inserting into `topics`, generate an embedding for each candidate keyword
   (Gemini embeddings, free tier) and compare cosine similarity against existing topics
   (last 90 days). Skip insert if similarity > 0.92 (duplicate).
7. Run an AI Topic Filter prompt (Gemini, free tier — this is a low-stakes
   classification task) against each new candidate: classify is_evergreen,
   is_us_audience, is_beginner_friendly, is_low_competition (booleans) + a 0-100 score.
   Store result, set status='filtered_pending' if score >= threshold else 'rejected'.
Do not call any topic "approved" automatically — that requires human action in Phase 6.
```

### Phase 3 — Keyword Expansion + Research Collection
```
For topics with status='filtered_pending':
1. Generate 5-8 keyword variants per topic via Gemini (free tier — low-stakes structural
   task, e.g. "Social Security" → "social security payment dates", "social security
   cola increase", etc). Store in topics or a keywords sub-table linked to topic_id.
2. Build a research collector restricted to an allowlist of domains only:
   irs.gov, ssa.gov, consumerfinance.gov, treasury.gov, usa.gov, medicare.gov, dol.gov.
   Fetch + parse relevant pages, store raw content in `research` table linked to topic_id.
3. CRITICAL STEP — dual-model fact extraction (this is the single highest-risk point
   in the whole pipeline, since errors here propagate silently downstream):
   - Run extraction TWICE on the same raw research text, independently: once with
     OpenAI, once with Gemini (free tier). Both get the same strict prompt: "extract
     only facts explicitly present in this text, do not infer."
   - Only auto-insert into `facts` if both models extracted the same value for the
     same fact_key (allow for formatting differences, e.g. "$23,000" vs "23000").
   - If the two extractions disagree, do NOT auto-insert — write both candidate values
     to a `fact_extraction_conflicts` table for manual resolution before the fact can
     be used in any draft.
   - On agreement, insert into `facts` with fact_key, fact_value, source_url,
     source_name, verified_date=today, expires_year (next year if annually adjusted —
     tax brackets, contribution limits, COLA — else null).
4. If a topic involves numeric claims (tax/benefit amounts) and zero facts were
   confirmed, set topic status='blocked_no_facts' and stop the pipeline for that topic.
```

### Phase 4 — Outline + Draft Generation (RAG-grounded)
```
For topics with research + facts present:
1. Generate an outline (H1, intro, H2 sections, FAQ) via Gemini (free tier — structural
   task, low stakes) based on the keyword + research summaries.
2. Generate the draft with OpenAI (paid — this is the reader-facing prose that drives
   ranking and AdSense RPM, worth the spend) using a system prompt that includes ALL
   of the following:

   FACT-GROUNDING RULES:
   - You are provided a [FACTS LIST] of verified figures sourced from official US
     government pages. You may ONLY state dollar amounts, dates, percentages, income
     thresholds, and eligibility limits that appear in this list.
   - If a needed figure is not in the list, write [FACT NEEDED] — never invent a number.
   - After every numeric claim, note the source in parentheses, e.g. "(IRS, 2026)".

   AUDIENCE + TONE RULES:
   - Write for a US audience. Assume the reader is intelligent but not a finance expert.
   - Write like a knowledgeable friend explaining over coffee — specific, direct,
     occasionally opinionated. Not a textbook, not a legal document.
   - Mix sentence lengths. Use short punchy sentences after complex ones. Vary rhythm.
   - Open with a hook in the first 1-2 sentences. No preamble, no "In this article
     we will explore..." — get to the point immediately.
   - Each paragraph makes ONE clear point. No filler. No padding.
   - Use concrete examples and real-world scenarios, not vague illustrations.
   - No first-person experiment claims ("I tried", "I tested", "I did X for 30 days").
   - No financial advice. No stock/crypto picks. No "you should invest in X."
   - Add a disclaimer at the end: "This article is for informational purposes only
     and does not constitute financial advice."

   BANNED PHRASES — never use any of these:
   "It is important to note", "It's worth mentioning", "In this article we will",
   "In conclusion", "To summarize", "Delve into", "Navigate the complexities",
   "In today's fast-paced world", "It goes without saying", "As we can see",
   "This guide will help you understand", "There are several key factors",
   "At the end of the day", "Game-changer", "Leverage", "Utilize" (use "use"),
   "Robust", "Comprehensive guide", "Let's dive in", "Without further ado."

3. Store the draft in `articles` (status='draft').
4. For every numeric/date claim in the draft, insert a row into `article_facts`
   linking article_id ↔ fact_id ↔ the exact claim_text used (use Gemini to map claims
   to facts — low-stakes mapping task — then validate deterministically in Phase 5).
5. If any "[FACT NEEDED]" markers exist, set status='blocked_missing_fact' and stop.
```

### Phase 4B — Prose Refinement Pass (Gemini, free tier)
```
Runs automatically after Phase 4 draft generation, before Phase 5 verification.
Goal: catch generic AI prose patterns the draft prompt missed, improve rhythm and
readability — NOT detection evasion (that's the wrong goal), genuine quality lift.

1. Send the full draft to Gemini with this editor prompt:

   SYSTEM: You are a senior editor at a US personal finance publication. You rewrite
   AI-generated drafts to sound like they were written by a sharp, experienced human
   finance journalist.

   TASK: Rewrite the provided draft. Preserve all facts, figures, source citations,
   and [FACT NEEDED] markers exactly. Do not add, remove, or change any number.

   REWRITING RULES:
   - Remove any remaining AI clichés not caught earlier (scan for: "it's important",
     "navigating", "in today's world", "seamlessly", "foster", "ensure").
   - If two consecutive sentences are similar in length and structure, rewrite one.
   - If an intro doesn't hook in the first two sentences, rewrite it until it does.
   - If a paragraph exceeds 5 sentences, split it.
   - Replace any vague statement like "many people struggle with X" with a specific
     scenario: "If your employer defaults to a 3% contribution rate, you could be
     leaving [FACT NEEDED] in employer match on the table."
   - Keep all headings, FAQ structure, and disclaimer intact.

   Return ONLY the rewritten article. No commentary, no explanation.

2. Diff the refined version against the original: flag any fact_value that changed
   (even formatting) and halt with status='refinement_changed_fact' — a human must
   check before proceeding. The refinement pass must never silently alter a number.
3. If no fact changes detected, overwrite articles.content with the refined version,
   log which prompt_version_id ran the refinement, and proceed to Phase 5.
```

### Phase 5 — Fact Verification Layer
```
Build a deterministic verification step (NOT just an LLM self-review):
1. For every row in article_facts for a given article, programmatically compare the
   claim_text's stated value against the linked fact's fact_value (string/number match,
   allow for formatting differences like "$23,000" vs "23000").
2. Any mismatch → flag the article, set status='failed_verification', write a
   verification_report (per-claim pass/fail) attached to the article, and route back
   to Phase 4's draft step with the specific failed claims as correction notes.
3. Only use an LLM judgment call for qualitative claims (non-numeric) — e.g. "is this
   process description accurate per the source text" — and log its reasoning.
4. Only articles with 100% pass on hard facts (dollar amounts, dates, %, eligibility
   thresholds) may advance to review_queue with status='review'.
```

### Phase 6 — Admin Review Dashboard
```
Build an authenticated admin UI (Next.js, admin-only routes) with TWO tabs:
"Topics & Research" and "Review Queue." This was previously under-specified — Phase 2
said topic approval "requires human action in Phase 6" but no topic-level UI was ever
defined, only article-level review. Fixing that here.

TAB 1 — Topics & Research (this did not exist before, adding it now):
1. List view of ALL topics regardless of status (filtered_pending / approved /
   rejected / blocked_no_facts / blocked_missing_fact / needs_refresh), showing:
   keyword, source (trends/gov_rss/google_news_rss/manual), AI filter score, cluster,
   created_at. Filterable by status and by source.
2. Topic detail view — full visibility into everything the pipeline collected before
   any draft gets written: keyword variants (Phase 3), every research row
   (source_url, trust_score, source_snapshot), every extracted fact (fact_key,
   fact_value, fact_type, source), and any unresolved fact_extraction_conflicts for
   that topic. You should be able to sanity-check the raw inputs, not just the final
   article.
3. Actions on a topic: Approve (status→approved, unblocks Phase 3/4 to proceed),
   Reject (status→rejected), Edit (correct a fact_value or remove a bad research row
   before it's used in a draft).
4. "Add Topic" button — manual entry form (keyword, category, notes) for topics
   sourced outside the automated pipeline — e.g. something you found browsing Reddit
   yourself, a competitor gap, anything. Sets source='manual', skips the AI Topic
   Filter (you've already decided it's worth pursuing) but still goes through
   Phase 3 (research/facts) and Phase 4/5 (draft/verification) like any other topic.

TAB 2 — Review Queue (articles):
5. Review queue list view: article title, topic, score, verification_report summary,
   output_type, review_priority, created_at, sorted by priority then oldest first.
6. Article detail/diff view: rendered draft + sidebar showing every claim with its
   linked source_url (so reviewer can click through to the .gov source per fact).
7. Actions: Approve (status→approved), Reject (status→rejected, requires
   rejected_reason), Request Revision (status→draft, requires revision_notes,
   increments revision_count, re-triggers Phase 4 generation with the notes injected
   into the prompt).
8. Reviewer must be selected from `authors` where is_real_reviewer=true; on approve,
   set articles.reviewed_by + reviewed_at.
9. Build a simple authors management page (CRUD) for managing personas (e.g. Maya
   Quinn as byline) and real reviewers (credentials, bio) separately.
10. REVIEW CHECKLIST — render as a required checkbox list inside the review screen.
    Reviewer cannot click Approve until all boxes are checked:
    □ No banned phrases present ("it's important to note", "in conclusion", etc.)
    □ Opening hook lands in first 1-2 sentences — no preamble
    □ Every number in the article appears in the verified facts sidebar
    □ No paragraph feels generic or could apply to any article on this topic
    □ Disclaimer ("not financial advice") is present at the end
    □ FAQ section answers are specific, not vague
    □ Internal links in "Related Guides" section are relevant, not just same-category
    □ No first-person experiment claims ("I tried", "I tested")
    □ Images: hero + thumbnail present, alt_text filled for all images
```

### Phase 7 — Publish Pipeline + Public Site
```
Build the public-facing blog:
1. Next.js public routes with SSG for published articles (revalidate via ISR or
   on-publish webhook), pulling only status='published' rows (RLS-enforced anon read).
2. Per article, render: byline (author persona) + "Reviewed by [real reviewer name,
   credentials]" + last-updated date + inline source citations linking to the .gov
   source_url stored per fact + a visible disclaimer ("not financial advice").
3. Add an About/Editorial Policy page describing the human review process.
4. Inject JSON-LD schema: Article, FAQPage (from the FAQ section), Person (author),
   BreadcrumbList.
5. Internal linking: on publish, query `clusters`/topics in the same cluster_id and
   category, auto-insert a "Related Guides" block (3-5 links) into the article.
6. On publish: regenerate sitemap.xml, ping Google Search Console's sitemap endpoint.
```

### Phase 8 — SEO Ops, Cost Tracking, Content Refresh
```
1. Integrate Google Search Console API: pull query/impression/position data weekly,
   surface "keyword opportunities" (high impressions, low CTR/position) back into a
   new topics row for content-update consideration.
2. Integrate GA4 API for a basic traffic dashboard in admin.
3. Wrap every OpenAI call across all phases with a token-usage logger writing to
   `cost_tracking` (run_type, tokens_used, cost_usd). Add a daily budget cap env var;
   if exceeded, halt automation runs and alert (log/email) rather than continue spending.
4. Build a scheduled job that checks `facts.expires_year` against the current year
   (e.g. runs every January for tax-bracket/contribution-limit facts). For any expired
   fact, find linked articles via article_facts and insert into
   content_refresh_log + set article status='needs_refresh', surfacing it back into
   the review queue instead of silently going stale.
```

---

## 6. Part 2 — Your 10 Additions (Validated)

Sab genuine gaps the, sab in-scope hain, merged into the schema below:

1. **Topic clustering** — valid, Google topical authority ka core lever. Refined: pillar should *be* a published article (`pillar_article_id`), not just a label.
2. **Cannibalization detection** — valid, was missing entirely. Needs to run twice: pre-draft (against approved topics) and pre-publish (against live articles).
3. **Source trust score** — valid. Better as a separate `source_domains` lookup table (DRY) instead of hardcoding per row.
4. **Source snapshot** — critical catch, was missing. .gov pages change/move silently; without a snapshot your audit trail breaks.
5. **fact_type enum** — valid, makes refresh automation calendar-aware instead of just year-aware (tax brackets ≠ COLA ≠ evergreen update windows).
6. **review_priority** — valid, simple add.
7. **Hallucination monitor** — valid. Better as a log table (`model_accuracy_log`) than a raw counter — counters drift, logs don't.
8. **Multi-model verification** — valid, good defense against correlated model blind spots + single-vendor outage risk.
9. **Prompt versioning** — valid, essential for debugging ranking drops later.
10. **SERP opportunity engine (position 4-15)** — valid refinement of the GSC step already in Phase 8, made more specific.

**Biggest improvement (video+article pipeline)** — valid and high-leverage since Maya Quinn already exists. Implemented as Phase 14 below: one fact-grounded research source branches into 5 output formats.

---

## 7. Merged Schema (extends Section 3)

```sql
-- REPLACES clusters table from Section 3
topic_clusters (
  id, cluster_name, pillar_article_id REFERENCES articles(id), category
)
-- topics gets: cluster_id FK → topic_clusters

-- NEW: canonical trust scores per domain
source_domains (
  id, domain, trust_score, label
  -- seed: irs.gov=100, ssa.gov=100, consumerfinance.gov=100, treasury.gov=100,
  -- medicare.gov=100, dol.gov=100, usa.gov=95, investopedia.com=60,
  -- nerdwallet.com=55, reddit.com=20
)

-- research table gains:
research ( ..., trust_score INT, source_snapshot TEXT )
-- trust_score copied from source_domains AT FETCH TIME (immutable snapshot,
-- doesn't change retroactively if you re-score a domain later)
-- source_snapshot = full extracted page text at time of fetch, for audit trail

-- facts table gains:
facts (
  ...,
  fact_type TEXT CHECK (fact_type IN
    ('annual_limit','tax_bracket','cola','income_threshold','evergreen')),
  source_snapshot TEXT
)

-- articles gains:
articles (
  ...,
  cannibalization_status TEXT DEFAULT 'none',  -- none / merge_candidate / reviewed
  cannibalization_match_id UUID REFERENCES articles(id),
  cannibalization_score FLOAT,
  prompt_version_id UUID REFERENCES prompt_versions(id),
  refinement_version_id UUID REFERENCES prompt_versions(id),
  -- tracks which prompt_version ran the Phase 4B refinement pass separately
  -- so you can isolate quality changes from draft changes in future analysis
  refinement_fact_change_flag BOOLEAN DEFAULT false
  -- true = refinement changed a fact value, halted for human review
)

-- review_queue gains:
review_queue (
  ...,
  review_priority TEXT DEFAULT 'normal' CHECK (review_priority IN ('urgent','normal','low'))
)

-- NEW
prompt_versions ( id, phase, prompt, version, created_at )

-- NEW: hallucination tracking (log, not a raw counter)
model_accuracy_log (
  id, model_name, phase, article_id, fact_id, was_correct BOOLEAN, logged_at
)

-- NEW: dual-extraction disagreement queue (OpenAI vs Gemini fact extraction)
fact_extraction_conflicts (
  id, topic_id, research_id, fact_key,
  openai_value, gemini_value, resolved_value, resolved_by, resolved_at
)

-- NEW: image system (manual, admin-triggered — see Phase 12)
image_assets (
  id, article_id,
  type TEXT CHECK (type IN ('hero','og','chart','icon','youtube_thumbnail','in_content')),
  source_method TEXT CHECK (source_method IN
    ('branded_template','chart_render','ai_generated','uploaded')),
  prompt_used TEXT,        -- only for ai_generated; stored for audit + regeneration
  placement TEXT,          -- 'hero' / 'thumbnail' / section-anchor id for middle images
  file_url, alt_text, width, height, generated_at
)

-- NEW: multi-format pipeline
content_outputs (
  id, topic_id,
  output_type TEXT CHECK (output_type IN
    ('blog_article','youtube_script','youtube_shorts_script','newsletter','twitter_thread')),
  linked_article_id UUID REFERENCES articles(id),
  content TEXT, status, created_at
)
```

---

## 8. Phase 9-14 — Codex Prompts (continues from Phase 8)

### Phase 9 — Topic Clustering + Cannibalization Detection
```
1. Build topic_clusters management: admin defines cluster_name + category. First
   approved article in a cluster becomes pillar_article_id (admin-assignable, or
   auto-suggest the highest-search-volume topic in the cluster as pillar).
2. On topic approval, require cluster_id assignment — suggest a cluster via OpenAI
   embedding match against existing cluster_name/category, admin confirms.
3. Run embedding similarity checks at TWO points: (a) pre-draft, against other
   approved/in-progress topics, (b) pre-publish, against all PUBLISHED articles'
   title+outline. If max similarity > 0.85, set cannibalization_status='merge_candidate',
   store cannibalization_match_id + cannibalization_score, and block auto-progress —
   route to review queue with note "merge with existing article instead of publishing new."
4. Reviewer chooses: merge (update/redirect existing article) or override (publish as
   distinct — e.g. different search intent). Log the decision on the article.
```

### Phase 10 — Source Trust + Snapshot System
```
1. Seed source_domains table with the trust scores above (admin-editable table, not
   hardcoded in app logic).
2. Update the Phase 3 research collector: on fetch, look up the domain's current
   trust_score, copy it onto the research row (immutable snapshot at fetch time), and
   store the full extracted page text into source_snapshot (on both research and facts).
3. Draft generation (Phase 4) must only pull facts where the linked research row has
   trust_score >= 80. Lower-trust sources may be stored for context but excluded from
   facts table / RAG grounding entirely.
4. Build a periodic re-fetch job: for fact_type in
   ('annual_limit','tax_bracket','cola','income_threshold'), re-fetch source_url on a
   schedule matched to that fact_type's known update window (tax brackets ~Oct/Nov,
   COLA ~Oct, contribution limits ~Oct/Nov), diff against the stored source_snapshot.
   If changed, write to content_refresh_log.
```

### Phase 11 — Multi-Model Verification + Hallucination Monitor + Prompt Versioning
```
1. Keep OpenAI (GPT) as the primary drafting model (Phase 4).
2. Add a second-pass verification call using Gemini (free tier — different model
   family than the drafter, so it catches different blind spots, at zero added cost)
   that independently re-checks each article_facts claim against its linked
   fact_value — log agreement/disagreement alongside the deterministic check from
   Phase 5.
3. Log every verification outcome (deterministic + each LLM check) into
   model_accuracy_log (model_name, phase, article_id, fact_id, was_correct).
4. Build an admin analytics view: hallucination rate per model_name over time
   (SUM(NOT was_correct)/COUNT(*) grouped by model_name) to see which model produces
   more factual errors and rebalance which model handles drafting vs verification.
5. Build prompt_versions: every system prompt used in Phase 2-5 is stored with an
   incrementing version on change. Every generated article stores which
   prompt_version_id produced its draft — lets you correlate ranking drops or quality
   dips back to a specific prompt change later.
```

### Phase 12 — Image & Chart Engine (Manual, Admin-Triggered)
```
Goal: full editorial control — nothing auto-generates or auto-attaches without an
explicit admin click. Every image slot supports Generate (AI, prompt-based), Quick
Generate (branded template, zero cost), and Upload (your own file).

1. Build an "Images" panel inside the article review/edit screen (Phase 6) with three
   slot types: Hero/Featured Image (1 per article), Middle/In-Content Images
   (repeatable — add as many as needed), YouTube Thumbnail (1 per article, feeds
   Phase 14). Each slot offers three actions: Quick Generate / AI Generate / Upload.

2. Quick Generate (branded template, zero ongoing cost — good default for hero/
   thumbnail/OG):
   - On click: render via Satori + resvg — article title (or admin-edited short
     text) overlaid on a consistent Maya Quinn-branded background.
   - Show a live preview. Admin can edit the overlay text and re-render before
     saving. On Save → upload to Supabase storage → insert into image_assets
     (source_method='branded_template').

3. AI Generate (prompt-based — for middle/explainer images or custom hero art):
   - On click: auto-build a SUGGESTED prompt from context (for hero, use article
     title + category; for a middle image, use the nearby H2 section's content) and
     show it in an editable textarea. Admin can use it as-is or rewrite it entirely
     before generating — this is the actual "click generate → prompt appears →
     image generates" flow you asked for.
   - Call an image generation API with the (possibly edited) prompt. Keep the
     provider swappable via env var rather than hardcoded (e.g. Gemini image
     generation if usable on a free/cheap tier, OpenAI images as a paid fallback) —
     confirm current pricing/availability before locking this in, since image-gen
     free tiers move independently of text free tiers.
   - Show the result with Regenerate / Save / Discard. On Save, insert into
     image_assets (source_method='ai_generated', prompt_used=<the exact prompt that
     produced it, stored for audit + easy regeneration later>).

4. Upload (manual):
   - Standard file picker → Supabase storage → insert into image_assets
     (source_method='uploaded'). Covers your own photos, licensed stock, anything.

5. Chart Generator stays separate and deterministic — NOT prompt-based, this is what
   protects data accuracy: admin clicks "Generate Chart," picks a fact_type group
   (cola/tax_bracket/annual_limit) attached to the article, system renders directly
   from facts.fact_value via Chart.js/node-canvas, shows a preview, admin Saves or
   Discards. Insert into image_assets (source_method='chart_render').

6. Placement: every image_assets row gets a `placement` value — 'hero', 'thumbnail',
   or a section-anchor (the H2 id it sits under) for middle images. Admin sets this
   via a dropdown in the Images panel at save time. Nothing is auto-inserted into the
   article body without this explicit placement step.

7. Alt_text: auto-suggested (Gemini, free tier) for every saved image regardless of
   source, shown as an editable field next to the preview — admin accepts or edits
   before final save. Required, blocks save if empty.

8. At publish time, the public site renders images strictly from each saved
   image_asset's placement — hero at top, thumbnail used for OG/social, middle
   images inserted at their assigned section anchors. WebP/AVIF, lazy-loaded, served
   via Next.js Image component — required for Core Web Vitals (ranking + AdSense RPM).
```

### Phase 13 — SERP Opportunity Engine (refines Phase 8)
```
1. Weekly job pulls Search Console query-level data per published article.
2. For any query with avg_position between 4 and 15 (page-1-but-not-top-3 = highest
   ROI refresh target) and impressions above a minimum threshold, flag the article:
   status='needs_refresh', reason='serp_opportunity', create a review_queue task with
   review_priority='urgent' if position is dropping week-over-week, else 'normal'.
3. Refresh task should include a gap analysis: scrape top-3 ranking competitors' H2
   headings for that query, diff against the article's current outline, suggest
   missing subtopics/FAQ entries to add.
```

### Phase 14 — Multi-Format Content Pipeline (Blog + Video + Newsletter + Social)
```
Once a topic is approved with research/facts in place:
1. Branch into content_outputs rows, one per output_type, ALL referencing the same
   topic_id and the same facts table (single source of truth — prevents factual
   drift between formats):
   - blog_article (existing Phase 4 pipeline)
   - youtube_script (long-form, matching your existing Maya Quinn second-by-second
     script format — voice-over + synced visual direction, grounded in same facts)
   - youtube_shorts_script (60-90s hook-driven cut)
   - newsletter (shorter, CTA-driven, links back to the blog article)
   - twitter_thread (5-8 tweet breakdown of the article's key facts)
2. Each output_type has its own prompt template (different tone/format) but the SAME
   fact-grounding constraint as Phase 4 — no output may state a number absent from
   the topic's facts table. Model assignment: blog_article uses OpenAI (it's the
   canonical, highest-stakes asset); youtube_script, youtube_shorts_script,
   newsletter, and twitter_thread all use Gemini (free tier) — these are derivative
   formats where the fact-grounding constraint, not raw prose quality, is what
   protects you.
3. Once the blog article publishes, set content_outputs.linked_article_id so
   newsletter/twitter content can reference the canonical URL.
4. All content_outputs route through review_queue (filterable by output_type) before
   being marked ready. This app generates + queues only — it does not auto-post to
   YouTube/Twitter/ESP; you take it from there into your existing tools.
```

### Phase 16 — Frontend Design System
```
Build the public-facing blog UI using the design tokens, assets, and visual direction
established in the mockup. Local design assets are at: E:\maya-quinn\blog
Reference this folder for all brand files (logo, colors, fonts, icons) before writing
any UI code. Do not invent brand assets — use what exists in that folder.

DESIGN TOKENS (hard-code these as CSS variables in globals.css):
  --ink:          #14213D   /* primary text, headings */
  --ink-soft:     #3A3D45   /* body copy */
  --paper:        #F6F7F9   /* page background */
  --card:         #FFFFFF   /* card/surface background */
  --gold:         #C89B3C   /* primary accent */
  --gold-light:   #E0B563   /* gradient top */
  --gold-deep:    #7C5C1E   /* text on gold backgrounds */
  --gold-tint:    #FBF3E1   /* fact chip background */
  --teal:         #2D6A6A   /* Taxes category */
  --teal-deep:    #1D4747
  --teal-tint:    #E8F2F1
  --rose:         #C2554F   /* Credit category */
  --rose-deep:    #8C3A35
  --rose-tint:    #FBEAE8
  --blue:         #3B6FA0   /* Banking category */
  --blue-deep:    #234A6B
  --blue-tint:    #E8F0F8
  --muted:        #6B6F76
  --hairline:     #E3E1DC

TYPOGRAPHY (Google Fonts, already in mockup):
  --font-display: 'Fraunces', serif         /* H1, H2, card titles */
  --font-body:    'Inter', sans-serif       /* all body copy, nav, labels */
  --font-mono:    'IBM Plex Mono', monospace /* numbers, fact chips, eyebrows */

CATEGORY COLOR SYSTEM:
  Retirement → gold  (--gold / --gold-tint / --gold-deep)
  Taxes      → teal  (--teal / --teal-tint / --teal-deep)
  Credit     → rose  (--rose / --rose-tint / --rose-deep)
  Banking    → blue  (--blue / --blue-tint / --blue-deep)
  Apply via data-category attribute on parent container, not per-component class.

COMPONENT SPECS (build as reusable components in /components/ui/):

1. FactChip — signature element, used inline within article body:
   - Renders any verified numeric claim as a gold gradient pill
   - Props: value (string), source (e.g. "IRS"), factId (UUID, links to fact row)
   - On click: open source_url in new tab (from article_facts → facts → source_url)
   - Style: IBM Plex Mono, gold gradient bg, checkmark prefix, source label suffix,
     box-shadow: 0 1px 5px rgba(200,155,60,0.3)

2. ArticleHero — dark navy gradient band with dot-grid texture:
   - Renders: category eyebrow (pill), H1, byline row
   - Byline row: avatar initials, author name, "Reviewed by [name, credentials]",
     updated date, read time
   - Background: linear-gradient(135deg, #0B1530, #16264A, #1F3258) +
     radial gold glow top-right + dot-grid overlay (SVG background-image pattern)

3. VerifiedSidebar — sticky sidebar for article pages:
   - TOC (table of contents, auto-generated from H2 headings, active link tracks scroll)
   - VerifiedBox (dark card: "Every number, sourced" + explanation)

4. ChartCard — wrapper for auto-generated fact charts:
   - Renders Chart.js bar/line chart from facts data passed as props
   - Footer note: "Rendered directly from verified [source] figures — not estimated."
   - Rounded corners, card shadow, border: 1px solid var(--hairline)

5. CalloutBox — info/warning/tip block:
   - Variants: info (teal), warning (gold), important (rose)
   - Left border accent + tinted background + circle icon

6. RelatedCard — category-color-coded guide cards:
   - Top border: 4px solid [category color]
   - Hover: translateY(-3px) + deeper shadow
   - Props: title, category, slug

7. ReviewChecklist — admin-only component (not on public site):
   - Renders the Phase 6 mandatory checklist as interactive checkboxes
   - Approve button stays disabled until all boxes checked
   - Persists checkbox state per article_id in review_queue

LAYOUT RULES:
  - Max content width: 1080px, centered
  - Article body column: max 680px
  - Sidebar column: 250px, sticky top: 96px
  - Grid: 1fr 250px with 52px gap (collapses to single column on mobile)
  - All images: Next.js <Image> component, WebP, lazy below fold
  - Hero images: 1200×630, OG images same dimensions
  - YouTube thumbnails: 1280×720

ADMIN DASHBOARD (separate visual direction — not public-site styled):
  - Use Tailwind utility classes only (no custom CSS) for admin routes
  - Shadcn/ui component library for tables, forms, modals, tabs
  - Sidebar nav with tabs: Topics & Research / Review Queue / Images /
    Authors / Clusters / Pipeline Logs / Analytics
  - Keep admin visually neutral (white/gray) — it's a tool, not a brand surface

ASSETS FOLDER USAGE (E:\maya-quinn\blog):
  - Check this folder for: logo file (SVG preferred), any brand color swatches,
    existing icon set, font files if self-hosted, any existing illustration assets
  - Logo: use as-is in header and favicon — do not recreate or restyle
  - Any image assets from this folder → copy to /public/brand/ in the Next.js project
  - If the folder contains a style guide or Figma export, those override the token
    values above where they conflict
```
```
1. Legal pages (required for AdSense approval): build Privacy Policy (cookies, ads,
   data collection disclosure), Terms of Service, and an Affiliate Disclosure page
   (stub it now even with no affiliate links yet — cheap to add, painful to retrofit
   once Google indexes the site without it). Link all three in the site footer.
2. Pipeline monitoring: wrap every scheduled job (Phase 2, 3, 8, 10, 13) with a
   try/catch that logs failures to a `pipeline_runs` table (job_name, status,
   error_message, started_at, finished_at) and sends a notification (email or Slack
   webhook — use whichever you already have) on failure. Silent failures (a broken
   RSS feed, an expired API key, a changed .gov page structure) are the most likely
   way this system quietly stops working without you noticing.
3. Backups: schedule a daily Supabase Postgres dump (pg_dump via GitHub Actions cron,
   or Supabase's built-in backup feature if on a paid plan) to a separate storage
   location (e.g. a private GitHub repo or cloud bucket). The `facts`, `articles`,
   and `source_snapshot` data is the entire value of this business — losing it is
   catastrophic and unrecoverable on the free Supabase tier.
```

---

## 9. Still-missing pieces for the AdSense-6-figures goal

- **AdSense policy compliance**: substantive content length minimum, ad density limits above the fold, ads.txt setup — add as a publish-checklist gate in Phase 7.
- **Core Web Vitals**: covered by SSG/ISR + lazy images (Phase 12), but add a Lighthouse CI check to the deploy pipeline so regressions get caught.
- **Newsletter sending**: content_outputs generates the copy, but you still need an ESP account (ConvertKit/Beehiiv/Mailchimp) to actually send.
- **Email capture on the live site**: newsletter content exists but there's no signup widget on the blog pages themselves to actually grow a list — add a simple capture form (footer + mid-article) wired to your ESP once chosen.
- **AdSense approval sequencing**: Google wants real traffic + content history before approval — publish ~20-30 solid, fact-verified articles first, then apply, rather than applying day one.
- **Affiliate layer (strategic, not built)**: pure display-ad RPM is a slow path to 6 figures on its own — finance affiliate offers (credit cards, banking signups) typically pay far more per reader than AdSense. Not in scope for this build, but worth knowing it's the more common path to the revenue number you're targeting. If you add it later: needs its own link-tracking table + FTC-compliant affiliate disclosure (the stub page from Phase 15 covers the disclosure requirement in advance).
- **Staging environment**: no separation yet between testing prompt/feature changes and the live site — worth a second Supabase project + preview deployment branch once the pipeline is stable, so prompt_versions changes can be tested before they touch published content.

---

## 10. Accounts Checklist

**Must have (pipeline won't run without these):**

| Account | Used for | Cost |
|---|---|---|
| OpenAI | Draft generation (Phase 4) + dual fact-extraction (Phase 3) | Paid, billing enabled |
| Google AI Studio (Gemini) | Topic filter, keyword expansion, outline, verification, alt-text, multi-format outputs | Free, no card needed |
| Supabase | DB, Auth, Storage | Free tier to start |
| GitHub | Repo + Actions (cron triggers for all scheduled jobs) | Free |
| Hosting (Cloudflare Pages or equivalent) | Public site + admin dashboard | Free, commercial-use safe |
| Domain registrar | Your domain — credibility requires a real domain, not a free subdomain | ~$10-15/year (the one unavoidable cost) |
| Google Search Console | Domain verification, performance data, sitemap ping (Phase 8, 13) | Free |
| Google Analytics 4 | Traffic dashboard (Phase 8) | Free |

**Optional / add later:**

| Account | When needed |
|---|---|
| ESP (ConvertKit / Beehiiv / Mailchimp) | Only once you actually want to send the newsletter content_outputs generates |
| Affiliate networks (if pursuing the affiliate layer above) | Only if/when you add affiliate monetization |

**Explicitly NOT needed (removed during this review):**
- Reddit API — ToS bars commercial use regardless of volume
- NewsAPI.org — free tier bars production use; replaced with Google News RSS (no account needed)

---

## Notes
- Reddit API: not used in the automated pipeline — free tier bars commercial use regardless of volume, paid tier is ~$12K/year. If you personally want Reddit-sourced topic ideas, browse manually and use the "Add Topic" button in Phase 6's Topics tab (personal browsing isn't subject to the Data API's commercial-use restriction) — just don't automate it. It still goes through the full research/facts/draft/verification pipeline like any other topic, it just enters manually instead of via Phase 2's auto-discovery.
- Topic discovery runs on Google Trends + government RSS feeds + Google News RSS — all genuinely free/compliant, no commercial-tier billing anywhere in that layer.
- AI spend is concentrated entirely on Phase 4's draft generation (OpenAI) plus the dual-extraction safety check in Phase 3 — every other LLM call in the system runs on Gemini's free tier. See Section 4's model assignment table.
- Treat Phase 4-5 (RAG-grounded generation + deterministic verification) as the core differentiator — this is what actually prevents the hallucinated-tax-bracket scenario that gets finance sites penalized.
- E-E-A-T fix isn't just technical — you'll eventually need a real named reviewer (you, or a hired CFP/financial writer) credited on every published article, not just an AI persona byline.
