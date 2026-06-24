import { estimateTokens, isFinanceRelevant } from "./text";
import type { TopicCandidate, TopicFilterResult } from "./types";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

type GeminiUsage = {
  totalTokenCount?: number;
};

export type GeminiCallUsage = {
  tokensUsed: number;
};

function getApiKey() {
  return process.env.GEMINI_API_KEY;
}

function topicFilterFallback(candidate: TopicCandidate): TopicFilterResult {
  const relevant = isFinanceRelevant(`${candidate.keyword} ${candidate.rawText}`);
  const beginner = !/(regulation|enforcement|sanction|litigation|rulemaking)/i.test(candidate.rawText);
  const evergreen = !/(today|yesterday|breaking|stock market|earnings)/i.test(candidate.keyword);
  const usAudience = /(irs|ssa|social security|medicare|treasury|dol|u\.s\.|us |federal|tax)/i.test(
    candidate.rawText
  );
  const score =
    (relevant ? 30 : 0) + (evergreen ? 20 : 0) + (usAudience ? 25 : 0) + (beginner ? 15 : 0);

  return {
    is_evergreen: evergreen,
    is_us_audience: usAudience,
    is_beginner_friendly: beginner,
    is_low_competition: relevant && evergreen,
    score,
    reason: getApiKey()
      ? "Gemini response could not be parsed; used deterministic fallback."
      : "GEMINI_API_KEY is not configured; used deterministic fallback."
  };
}

export async function embedKeyword(keyword: string): Promise<{ embedding: number[] | null; usage: GeminiCallUsage }> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { embedding: null, usage: { tokensUsed: estimateTokens(keyword) } };
  }

  const model = process.env.GEMINI_EMBEDDING_MODEL ?? "text-embedding-004";
  const response = await fetch(`${GEMINI_BASE_URL}/models/${model}:embedContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `models/${model}`,
      content: {
        parts: [{ text: keyword }]
      },
      taskType: "SEMANTIC_SIMILARITY"
    })
  });

  if (!response.ok) {
    throw new Error(`Gemini embedding failed: ${response.status} ${await response.text()}`);
  }

  const json = (await response.json()) as { embedding?: { values?: number[] } };
  return {
    embedding: json.embedding?.values ?? null,
    usage: { tokensUsed: estimateTokens(keyword) }
  };
}

export async function filterTopic(
  candidate: TopicCandidate
): Promise<{ filter: TopicFilterResult; usage: GeminiCallUsage }> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      filter: topicFilterFallback(candidate),
      usage: { tokensUsed: estimateTokens(`${candidate.keyword}\n${candidate.rawText}`) }
    };
  }

  const model = process.env.GEMINI_TOPIC_FILTER_MODEL ?? "gemini-1.5-flash-latest";
  const prompt = `Classify this finance content idea for a beginner US personal-finance blog.

Return only valid JSON with:
{
  "is_evergreen": boolean,
  "is_us_audience": boolean,
  "is_beginner_friendly": boolean,
  "is_low_competition": boolean,
  "score": number,
  "reason": string
}

Score should be 0-100. High scores mean useful, specific, fact-grounded, beginner-friendly, US audience, and not just generic breaking news.

Keyword: ${candidate.keyword}
Source: ${candidate.source}
Category: ${candidate.category}
Raw text: ${candidate.rawText.slice(0, 3000)}`;

  const response = await fetch(`${GEMINI_BASE_URL}/models/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json"
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Gemini topic filter failed: ${response.status} ${await response.text()}`);
  }

  const json = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: GeminiUsage;
  };
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  try {
    const parsed = JSON.parse(text) as TopicFilterResult;
    return {
      filter: {
        is_evergreen: Boolean(parsed.is_evergreen),
        is_us_audience: Boolean(parsed.is_us_audience),
        is_beginner_friendly: Boolean(parsed.is_beginner_friendly),
        is_low_competition: Boolean(parsed.is_low_competition),
        score: Math.max(0, Math.min(100, Number(parsed.score) || 0)),
        reason: String(parsed.reason ?? "").slice(0, 500)
      },
      usage: { tokensUsed: json.usageMetadata?.totalTokenCount ?? estimateTokens(prompt) }
    };
  } catch {
    return {
      filter: topicFilterFallback(candidate),
      usage: { tokensUsed: json.usageMetadata?.totalTokenCount ?? estimateTokens(prompt) }
    };
  }
}
