create extension if not exists vector;

alter table public.topics
  add column if not exists raw_text text,
  add column if not exists source_url text,
  add column if not exists source_name text,
  add column if not exists keyword_embedding vector(768),
  add column if not exists is_evergreen boolean,
  add column if not exists is_us_audience boolean,
  add column if not exists is_beginner_friendly boolean,
  add column if not exists is_low_competition boolean,
  add column if not exists filter_reason text,
  add column if not exists discovered_at timestamptz not null default now(),
  add column if not exists duplicate_of uuid references public.topics(id) on delete set null,
  add column if not exists duplicate_similarity numeric(6,5);

create index if not exists topics_created_at_idx on public.topics(created_at);
create index if not exists topics_discovered_at_idx on public.topics(discovered_at);
create index if not exists topics_keyword_embedding_idx
  on public.topics using ivfflat (keyword_embedding vector_cosine_ops)
  with (lists = 100);
