# Maya Quinn Finance Automation

Next.js 14 App Router foundation for a finance content automation system.

## Setup

1. Copy `.env.example` to `.env.local`.
2. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `ADMIN_EMAILS`.
3. Apply the migration with `npm run db:migrate`. If your network cannot reach the direct IPv6 Postgres host, set `SUPABASE_DB_URL` to Supabase's Session Pooler connection string and rerun it.
4. Mark production admin users with Supabase `app_metadata.role = "admin"` so RLS policies allow protected table access. The app also checks `ADMIN_EMAILS` before sending magic links.
5. Run:

```bash
npm install
npm run dev
```

Visit `http://localhost:3000/admin/login` and request a magic link for an email in `ADMIN_EMAILS`.

## Phase 1 Scope

- Supabase browser and server clients.
- Magic-link admin login.
- Protected admin dashboard.
- SQL migration for `topics`, `research`, `articles`, `review_queue`, `facts`, `article_facts`, `clusters`, `authors`, `content_refresh_log`, and `cost_tracking`.
- RLS that lets anonymous users read only `articles` where `status = 'published'`; all writes and protected reads require an authenticated admin claim.

## Phase 2 Topic Discovery

The daily job lives at `GET /api/cron/topic-discovery` and is scheduled in `vercel.json` for 09:00 UTC.

Required server-only environment variables:

```bash
SUPABASE_SERVICE_ROLE_KEY=...
CRON_SECRET=...
GEMINI_API_KEY=...
```

Run manually:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/topic-discovery
```

The job pulls official agency news pages/RSS, Google News RSS, and Google Trends via `google-trends-api`. It embeds each keyword with Gemini, skips candidates with cosine similarity above `0.92` against topics from the last 90 days, then stores Gemini topic-filter results as `filtered_pending` or `rejected`. It never auto-approves topics.
