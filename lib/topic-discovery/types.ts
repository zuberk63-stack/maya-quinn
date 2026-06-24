export type TopicSource = "gov_rss" | "trends" | "google_news_rss";

export type TopicCandidate = {
  keyword: string;
  source: TopicSource;
  rawText: string;
  category: string;
  sourceUrl?: string;
  sourceName?: string;
};

export type TopicFilterResult = {
  is_evergreen: boolean;
  is_us_audience: boolean;
  is_beginner_friendly: boolean;
  is_low_competition: boolean;
  score: number;
  reason: string;
};

export type DiscoveryResult = {
  fetched: number;
  normalized: number;
  inserted: number;
  rejected: number;
  duplicates: number;
  errors: string[];
};
