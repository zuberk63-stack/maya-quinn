create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    or (auth.jwt() -> 'app_metadata' -> 'roles') ? 'admin',
    false
  );
$$;

create table if not exists public.clusters (
  id uuid primary key default gen_random_uuid(),
  pillar_title text not null,
  pillar_slug text not null unique,
  category text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.authors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  bio text,
  credentials text,
  avatar_url text,
  is_real_reviewer boolean not null default false,
  supabase_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.topics (
  id uuid primary key default gen_random_uuid(),
  keyword text not null,
  title text,
  slug text unique,
  category text,
  status text not null default 'filtered_pending'
    check (status in (
      'filtered_pending',
      'approved',
      'rejected',
      'blocked_no_facts',
      'blocked_missing_fact',
      'needs_refresh',
      'drafted',
      'published'
    )),
  source text not null default 'auto'
    check (source in ('auto', 'trends', 'gov_rss', 'google_news_rss', 'manual')),
  notes text,
  ai_filter_score numeric(5,2),
  cluster_id uuid references public.clusters(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.research (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.topics(id) on delete cascade,
  source_url text not null,
  source_name text,
  source_domain text,
  title text,
  summary text,
  raw_content text,
  collected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (topic_id, source_url)
);

create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid references public.topics(id) on delete set null,
  title text not null,
  slug text not null unique,
  postalias text unique,
  content text not null,
  summary text,
  thumbnail text,
  category text,
  tags text[] default '{}',
  status text not null default 'draft'
    check (status in ('draft', 'review', 'approved', 'rejected', 'published', 'needs_refresh', 'archived')),
  author_id uuid references public.authors(id) on delete set null,
  reviewed_by uuid references public.authors(id) on delete set null,
  reviewed_at timestamptz,
  verification_report jsonb,
  published_at timestamptz,
  views integer not null default 0 check (views >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.facts (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid references public.topics(id) on delete cascade,
  research_id uuid references public.research(id) on delete set null,
  fact_key text not null,
  fact_value text not null,
  source_url text not null,
  source_name text,
  verified_date date not null default current_date,
  expires_year integer check (expires_year is null or expires_year >= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (topic_id, fact_key, source_url)
);

create table if not exists public.article_facts (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles(id) on delete cascade,
  fact_id uuid not null references public.facts(id) on delete restrict,
  claim_text text not null,
  created_at timestamptz not null default now(),
  unique (article_id, fact_id, claim_text)
);

create table if not exists public.review_queue (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles(id) on delete cascade,
  review_status text not null default 'review'
    check (review_status in ('review', 'approved', 'rejected', 'revision_requested')),
  reviewed_by uuid references public.authors(id) on delete set null,
  reviewed_at timestamptz,
  revision_notes text,
  rejected_reason text,
  revision_count integer not null default 0 check (revision_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (article_id)
);

create table if not exists public.content_refresh_log (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles(id) on delete cascade,
  fact_id uuid references public.facts(id) on delete set null,
  flagged_at timestamptz not null default now(),
  resolved_at timestamptz,
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.cost_tracking (
  id uuid primary key default gen_random_uuid(),
  run_type text not null,
  tokens_used integer not null default 0 check (tokens_used >= 0),
  cost_usd numeric(12,6) not null default 0 check (cost_usd >= 0),
  created_at timestamptz not null default now()
);

create index if not exists topics_status_idx on public.topics(status);
create index if not exists topics_source_idx on public.topics(source);
create index if not exists topics_cluster_id_idx on public.topics(cluster_id);
create index if not exists research_topic_id_idx on public.research(topic_id);
create index if not exists articles_status_idx on public.articles(status);
create index if not exists articles_topic_id_idx on public.articles(topic_id);
create index if not exists facts_topic_id_idx on public.facts(topic_id);
create index if not exists article_facts_article_id_idx on public.article_facts(article_id);
create index if not exists review_queue_status_idx on public.review_queue(review_status);
create index if not exists content_refresh_log_article_id_idx on public.content_refresh_log(article_id);
create index if not exists cost_tracking_run_type_created_at_idx on public.cost_tracking(run_type, created_at);

drop trigger if exists set_clusters_updated_at on public.clusters;
create trigger set_clusters_updated_at
before update on public.clusters
for each row execute function public.set_updated_at();

drop trigger if exists set_authors_updated_at on public.authors;
create trigger set_authors_updated_at
before update on public.authors
for each row execute function public.set_updated_at();

drop trigger if exists set_topics_updated_at on public.topics;
create trigger set_topics_updated_at
before update on public.topics
for each row execute function public.set_updated_at();

drop trigger if exists set_articles_updated_at on public.articles;
create trigger set_articles_updated_at
before update on public.articles
for each row execute function public.set_updated_at();

drop trigger if exists set_facts_updated_at on public.facts;
create trigger set_facts_updated_at
before update on public.facts
for each row execute function public.set_updated_at();

drop trigger if exists set_review_queue_updated_at on public.review_queue;
create trigger set_review_queue_updated_at
before update on public.review_queue
for each row execute function public.set_updated_at();

alter table public.clusters enable row level security;
alter table public.authors enable row level security;
alter table public.topics enable row level security;
alter table public.research enable row level security;
alter table public.articles enable row level security;
alter table public.facts enable row level security;
alter table public.article_facts enable row level security;
alter table public.review_queue enable row level security;
alter table public.content_refresh_log enable row level security;
alter table public.cost_tracking enable row level security;

drop policy if exists "Public can read published articles" on public.articles;
drop policy if exists "Admins can select articles" on public.articles;
drop policy if exists "Admins can insert articles" on public.articles;
drop policy if exists "Admins can update articles" on public.articles;
drop policy if exists "Admins can delete articles" on public.articles;
drop policy if exists "Admins can select clusters" on public.clusters;
drop policy if exists "Admins can insert clusters" on public.clusters;
drop policy if exists "Admins can update clusters" on public.clusters;
drop policy if exists "Admins can delete clusters" on public.clusters;
drop policy if exists "Admins can select authors" on public.authors;
drop policy if exists "Admins can insert authors" on public.authors;
drop policy if exists "Admins can update authors" on public.authors;
drop policy if exists "Admins can delete authors" on public.authors;
drop policy if exists "Admins can select topics" on public.topics;
drop policy if exists "Admins can insert topics" on public.topics;
drop policy if exists "Admins can update topics" on public.topics;
drop policy if exists "Admins can delete topics" on public.topics;
drop policy if exists "Admins can select research" on public.research;
drop policy if exists "Admins can insert research" on public.research;
drop policy if exists "Admins can update research" on public.research;
drop policy if exists "Admins can delete research" on public.research;
drop policy if exists "Admins can select facts" on public.facts;
drop policy if exists "Admins can insert facts" on public.facts;
drop policy if exists "Admins can update facts" on public.facts;
drop policy if exists "Admins can delete facts" on public.facts;
drop policy if exists "Admins can select article_facts" on public.article_facts;
drop policy if exists "Admins can insert article_facts" on public.article_facts;
drop policy if exists "Admins can update article_facts" on public.article_facts;
drop policy if exists "Admins can delete article_facts" on public.article_facts;
drop policy if exists "Admins can select review_queue" on public.review_queue;
drop policy if exists "Admins can insert review_queue" on public.review_queue;
drop policy if exists "Admins can update review_queue" on public.review_queue;
drop policy if exists "Admins can delete review_queue" on public.review_queue;
drop policy if exists "Admins can select content_refresh_log" on public.content_refresh_log;
drop policy if exists "Admins can insert content_refresh_log" on public.content_refresh_log;
drop policy if exists "Admins can update content_refresh_log" on public.content_refresh_log;
drop policy if exists "Admins can delete content_refresh_log" on public.content_refresh_log;
drop policy if exists "Admins can select cost_tracking" on public.cost_tracking;
drop policy if exists "Admins can insert cost_tracking" on public.cost_tracking;
drop policy if exists "Admins can update cost_tracking" on public.cost_tracking;
drop policy if exists "Admins can delete cost_tracking" on public.cost_tracking;

create policy "Public can read published articles"
on public.articles
for select
to anon
using (status = 'published');

create policy "Admins can select articles"
on public.articles
for select
to authenticated
using (public.is_admin());

create policy "Admins can insert articles"
on public.articles
for insert
to authenticated
with check (public.is_admin());

create policy "Admins can update articles"
on public.articles
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "Admins can delete articles"
on public.articles
for delete
to authenticated
using (public.is_admin());

create policy "Admins can select clusters"
on public.clusters for select to authenticated using (public.is_admin());
create policy "Admins can insert clusters"
on public.clusters for insert to authenticated with check (public.is_admin());
create policy "Admins can update clusters"
on public.clusters for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins can delete clusters"
on public.clusters for delete to authenticated using (public.is_admin());

create policy "Admins can select authors"
on public.authors for select to authenticated using (public.is_admin());
create policy "Admins can insert authors"
on public.authors for insert to authenticated with check (public.is_admin());
create policy "Admins can update authors"
on public.authors for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins can delete authors"
on public.authors for delete to authenticated using (public.is_admin());

create policy "Admins can select topics"
on public.topics for select to authenticated using (public.is_admin());
create policy "Admins can insert topics"
on public.topics for insert to authenticated with check (public.is_admin());
create policy "Admins can update topics"
on public.topics for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins can delete topics"
on public.topics for delete to authenticated using (public.is_admin());

create policy "Admins can select research"
on public.research for select to authenticated using (public.is_admin());
create policy "Admins can insert research"
on public.research for insert to authenticated with check (public.is_admin());
create policy "Admins can update research"
on public.research for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins can delete research"
on public.research for delete to authenticated using (public.is_admin());

create policy "Admins can select facts"
on public.facts for select to authenticated using (public.is_admin());
create policy "Admins can insert facts"
on public.facts for insert to authenticated with check (public.is_admin());
create policy "Admins can update facts"
on public.facts for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins can delete facts"
on public.facts for delete to authenticated using (public.is_admin());

create policy "Admins can select article_facts"
on public.article_facts for select to authenticated using (public.is_admin());
create policy "Admins can insert article_facts"
on public.article_facts for insert to authenticated with check (public.is_admin());
create policy "Admins can update article_facts"
on public.article_facts for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins can delete article_facts"
on public.article_facts for delete to authenticated using (public.is_admin());

create policy "Admins can select review_queue"
on public.review_queue for select to authenticated using (public.is_admin());
create policy "Admins can insert review_queue"
on public.review_queue for insert to authenticated with check (public.is_admin());
create policy "Admins can update review_queue"
on public.review_queue for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins can delete review_queue"
on public.review_queue for delete to authenticated using (public.is_admin());

create policy "Admins can select content_refresh_log"
on public.content_refresh_log for select to authenticated using (public.is_admin());
create policy "Admins can insert content_refresh_log"
on public.content_refresh_log for insert to authenticated with check (public.is_admin());
create policy "Admins can update content_refresh_log"
on public.content_refresh_log for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins can delete content_refresh_log"
on public.content_refresh_log for delete to authenticated using (public.is_admin());

create policy "Admins can select cost_tracking"
on public.cost_tracking for select to authenticated using (public.is_admin());
create policy "Admins can insert cost_tracking"
on public.cost_tracking for insert to authenticated with check (public.is_admin());
create policy "Admins can update cost_tracking"
on public.cost_tracking for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins can delete cost_tracking"
on public.cost_tracking for delete to authenticated using (public.is_admin());
