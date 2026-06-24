import Parser from "rss-parser";
import * as cheerio from "cheerio";
import { GOOGLE_NEWS_SEEDS, inferCategory, isFinanceRelevant, normalizeKeyword, stripHtml } from "./text";
import type { TopicCandidate } from "./types";

const parser = new Parser({
  timeout: 15000,
  headers: {
    "User-Agent": "MayaQuinnTopicDiscovery/1.0 (+https://github.com/zuberk63-stack/maya-quinn)"
  }
});

type AgencyPage = {
  name: string;
  url: string;
  maxItems?: number;
};

const AGENCY_PAGES: AgencyPage[] = [
  { name: "IRS", url: "https://www.irs.gov/newsroom/irs-newswire" },
  { name: "Social Security Administration", url: "https://www.ssa.gov/news/press/releases/" },
  { name: "Consumer Financial Protection Bureau", url: "https://www.consumerfinance.gov/about-us/newsroom/feed/" },
  { name: "U.S. Treasury", url: "https://home.treasury.gov/news/press-releases" },
  { name: "Department of Labor", url: "https://www.dol.gov/newsroom/releases" },
  { name: "Medicare", url: "https://www.medicare.gov/blog" }
];

function resolveUrl(href: string | undefined, base: string) {
  if (!href) return undefined;
  try {
    return new URL(href, base).toString();
  } catch {
    return undefined;
  }
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "MayaQuinnTopicDiscovery/1.0 (+https://github.com/zuberk63-stack/maya-quinn)",
      Accept: "application/rss+xml, application/atom+xml, text/html, */*"
    },
    next: { revalidate: 0 }
  });

  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }

  return response.text();
}

function fromRssItem(item: Parser.Item, sourceName: string, source: TopicCandidate["source"]): TopicCandidate | null {
  const keyword = normalizeKeyword(item.title ?? "");
  const rawText = stripHtml(`${item.title ?? ""} ${item.contentSnippet ?? item.content ?? ""}`);

  if (!keyword || keyword.length < 8 || !isFinanceRelevant(rawText)) {
    return null;
  }

  return {
    keyword,
    source,
    rawText,
    category: inferCategory(rawText),
    sourceUrl: item.link,
    sourceName
  };
}

async function fetchRssCandidates(url: string, sourceName: string, source: TopicCandidate["source"]) {
  const feed = await parser.parseURL(url);
  return feed.items
    .slice(0, 20)
    .map((item) => fromRssItem(item, sourceName, source))
    .filter((item): item is TopicCandidate => Boolean(item));
}

function parseHtmlCandidates(html: string, page: AgencyPage) {
  const $ = cheerio.load(html);
  const candidates: TopicCandidate[] = [];

  $("main a, article a, .view-content a, .content a, a").each((_, element) => {
    if (candidates.length >= (page.maxItems ?? 20)) return;

    const title = normalizeKeyword($(element).text());
    if (title.length < 25 || title.length > 180) return;

    const href = resolveUrl($(element).attr("href"), page.url);
    const nearbyText = stripHtml(
      `${title} ${$(element).parent().text()} ${$(element).closest("article, li, div").text()}`
    ).slice(0, 1500);

    if (!isFinanceRelevant(nearbyText)) return;

    candidates.push({
      keyword: title,
      source: "gov_rss",
      rawText: nearbyText,
      category: inferCategory(nearbyText),
      sourceUrl: href,
      sourceName: page.name
    });
  });

  return candidates;
}

export async function fetchGovernmentCandidates() {
  const output: TopicCandidate[] = [];
  const errors: string[] = [];

  for (const page of AGENCY_PAGES) {
    try {
      const rssCandidates = await fetchRssCandidates(page.url, page.name, "gov_rss");
      output.push(...rssCandidates);
      if (rssCandidates.length > 0) continue;
    } catch {
      // Many agency news pages are HTML-only. Fall through to the HTML parser.
    }

    try {
      const html = await fetchText(page.url);
      output.push(...parseHtmlCandidates(html, page));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return { candidates: output, errors };
}

export async function fetchGoogleNewsCandidates() {
  const output: TopicCandidate[] = [];
  const errors: string[] = [];

  for (const seed of GOOGLE_NEWS_SEEDS) {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${seed} when:7d`)}&hl=en-US&gl=US&ceid=US:en`;
    try {
      const candidates = await fetchRssCandidates(url, "Google News", "google_news_rss");
      output.push(
        ...candidates.map((candidate) => ({ ...candidate, category: inferCategory(`${seed} ${candidate.rawText}`) }))
      );
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return { candidates: output, errors };
}

type GoogleTrendsApi = {
  dailyTrends: (options: { trendDate: Date; geo: string }) => Promise<string>;
};

function parseTrendTitle(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "query" in value) {
    return String((value as { query?: string }).query ?? "");
  }
  return "";
}

export async function fetchTrendCandidates() {
  const output: TopicCandidate[] = [];
  const errors: string[] = [];

  try {
    const trends = (await import("google-trends-api")) as unknown as GoogleTrendsApi;
    const raw = await trends.dailyTrends({ trendDate: new Date(), geo: "US" });
    const json = JSON.parse(raw) as {
      default?: {
        trendingSearchesDays?: Array<{
          trendingSearches?: Array<{
            title?: unknown;
            articles?: Array<{ title?: string; snippet?: string; url?: string; source?: string }>;
          }>;
        }>;
      };
    };

    for (const day of json.default?.trendingSearchesDays ?? []) {
      for (const trend of day.trendingSearches ?? []) {
        const keyword = normalizeKeyword(parseTrendTitle(trend.title));
        const rawText = stripHtml(
          `${keyword} ${(trend.articles ?? []).map((article) => `${article.title ?? ""} ${article.snippet ?? ""}`).join(" ")}`
        );

        if (!keyword || !isFinanceRelevant(rawText)) continue;

        output.push({
          keyword,
          source: "trends",
          rawText,
          category: inferCategory(rawText),
          sourceUrl: trend.articles?.[0]?.url,
          sourceName: trend.articles?.[0]?.source ?? "Google Trends"
        });
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  return { candidates: output, errors };
}
