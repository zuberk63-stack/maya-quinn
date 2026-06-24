import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { dedupeCandidates } from "./text";
import { embedKeyword, filterTopic } from "./gemini";
import { cosineSimilarity, parseEmbedding, toVectorLiteral } from "./similarity";
import { fetchGoogleNewsCandidates, fetchGovernmentCandidates, fetchTrendCandidates } from "./sources";
import type { DiscoveryResult, TopicCandidate } from "./types";

type ExistingTopic = {
  id: string;
  keyword: string;
  keyword_embedding: unknown;
};

const DEFAULT_SCORE_THRESHOLD = 65;
const DUPLICATE_THRESHOLD = 0.92;

function getScoreThreshold() {
  const parsed = Number(process.env.TOPIC_FILTER_SCORE_THRESHOLD);
  return Number.isFinite(parsed) ? parsed : DEFAULT_SCORE_THRESHOLD;
}

async function getExistingTopics() {
  const supabase = createSupabaseAdminClient();
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("topics")
    .select("id, keyword, keyword_embedding")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) {
    throw error;
  }

  return (data ?? []) as ExistingTopic[];
}

function findDuplicate(candidateEmbedding: number[] | null, existingTopics: ExistingTopic[]) {
  if (!candidateEmbedding) {
    return null;
  }

  let best: { id: string; keyword: string; similarity: number } | null = null;

  for (const topic of existingTopics) {
    const existingEmbedding = parseEmbedding(topic.keyword_embedding);
    if (!existingEmbedding) continue;

    const similarity = cosineSimilarity(candidateEmbedding, existingEmbedding);
    if (!best || similarity > best.similarity) {
      best = { id: topic.id, keyword: topic.keyword, similarity };
    }
  }

  return best && best.similarity > DUPLICATE_THRESHOLD ? best : null;
}

async function insertCandidate(candidate: TopicCandidate, existingTopics: ExistingTopic[]) {
  const supabase = createSupabaseAdminClient();
  const embeddingResult = await embedKeyword(candidate.keyword);
  const duplicate = findDuplicate(embeddingResult.embedding, existingTopics);

  if (duplicate) {
    return {
      action: "duplicate" as const,
      tokensUsed: embeddingResult.usage.tokensUsed
    };
  }

  const filterResult = await filterTopic(candidate);
  const status = filterResult.filter.score >= getScoreThreshold() ? "filtered_pending" : "rejected";

  const { data, error } = await supabase
    .from("topics")
    .insert({
      keyword: candidate.keyword,
      title: candidate.keyword,
      category: candidate.category,
      status,
      source: candidate.source,
      raw_text: candidate.rawText,
      source_url: candidate.sourceUrl,
      source_name: candidate.sourceName,
      keyword_embedding: embeddingResult.embedding ? toVectorLiteral(embeddingResult.embedding) : null,
      is_evergreen: filterResult.filter.is_evergreen,
      is_us_audience: filterResult.filter.is_us_audience,
      is_beginner_friendly: filterResult.filter.is_beginner_friendly,
      is_low_competition: filterResult.filter.is_low_competition,
      ai_filter_score: filterResult.filter.score,
      filter_reason: filterResult.filter.reason
    })
    .select("id, keyword, keyword_embedding")
    .single();

  if (error) {
    throw error;
  }

  if (data) {
    existingTopics.unshift(data as ExistingTopic);
  }

  return {
    action: status === "filtered_pending" ? ("inserted" as const) : ("rejected" as const),
    tokensUsed: embeddingResult.usage.tokensUsed + filterResult.usage.tokensUsed
  };
}

export async function runTopicDiscovery() {
  const result: DiscoveryResult = {
    fetched: 0,
    normalized: 0,
    inserted: 0,
    rejected: 0,
    duplicates: 0,
    errors: []
  };
  let tokensUsed = 0;

  const [government, trends, googleNews] = await Promise.all([
    fetchGovernmentCandidates(),
    fetchTrendCandidates(),
    fetchGoogleNewsCandidates()
  ]);

  result.errors.push(...government.errors, ...trends.errors, ...googleNews.errors);

  const candidates = dedupeCandidates([
    ...government.candidates,
    ...trends.candidates,
    ...googleNews.candidates
  ]);

  result.fetched = government.candidates.length + trends.candidates.length + googleNews.candidates.length;
  result.normalized = candidates.length;

  const existingTopics = await getExistingTopics();

  for (const candidate of candidates) {
    try {
      const insertResult = await insertCandidate(candidate, existingTopics);
      tokensUsed += insertResult.tokensUsed;

      if (insertResult.action === "inserted") result.inserted += 1;
      if (insertResult.action === "rejected") result.rejected += 1;
      if (insertResult.action === "duplicate") result.duplicates += 1;
    } catch (error) {
      result.errors.push(
        `${candidate.source}:${candidate.keyword}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  try {
    const supabase = createSupabaseAdminClient();
    await supabase.from("cost_tracking").insert({
      run_type: "topic_discovery",
      tokens_used: tokensUsed,
      cost_usd: 0
    });
  } catch (error) {
    result.errors.push(`cost_tracking: ${error instanceof Error ? error.message : String(error)}`);
  }

  return result;
}
