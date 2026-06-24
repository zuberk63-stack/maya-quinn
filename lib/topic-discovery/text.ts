import type { TopicCandidate } from "./types";

const FINANCE_TERMS = [
  "401k",
  "ira",
  "retirement",
  "social security",
  "medicare",
  "tax",
  "irs",
  "refund",
  "benefit",
  "cola",
  "student loan",
  "mortgage",
  "credit",
  "debt",
  "inflation",
  "interest rate",
  "savings",
  "bank",
  "consumer finance",
  "unemployment",
  "wage",
  "overtime",
  "pension"
];

export const GOOGLE_NEWS_SEEDS = [
  "2026 tax brackets",
  "IRS tax updates",
  "Social Security benefits",
  "Medicare premiums",
  "401k contribution limit",
  "Roth IRA income limits",
  "mortgage rates",
  "student loan repayment",
  "credit card debt",
  "retirement planning"
];

export function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function stripHtml(value: string) {
  return normalizeWhitespace(value.replace(/<[^>]*>/g, " "));
}

export function normalizeKeyword(value: string) {
  return normalizeWhitespace(
    stripHtml(value)
      .replace(/\s[-|–].*$/, "")
      .replace(/^breaking:\s*/i, "")
      .replace(/^update:\s*/i, "")
  ).slice(0, 180);
}

export function isFinanceRelevant(value: string) {
  const text = value.toLowerCase();
  return FINANCE_TERMS.some((term) => text.includes(term));
}

export function inferCategory(value: string) {
  const text = value.toLowerCase();

  if (/(401k|ira|retirement|pension)/.test(text)) return "retirement";
  if (/(social security|ssi|cola)/.test(text)) return "social_security";
  if (/(medicare|medicaid|health plan|premium)/.test(text)) return "medicare";
  if (/(tax|irs|refund|deduction|credit)/.test(text)) return "tax";
  if (/(mortgage|homebuying|home loan)/.test(text)) return "mortgage";
  if (/(student loan|student debt|fafsa)/.test(text)) return "student_loans";
  if (/(credit card|credit report|credit score|debt)/.test(text)) return "credit";
  if (/(unemployment|wage|overtime|benefit)/.test(text)) return "work_benefits";

  return "personal_finance";
}

export function stableCandidateKey(candidate: TopicCandidate) {
  return `${candidate.source}:${candidate.keyword.toLowerCase()}`;
}

export function dedupeCandidates(candidates: TopicCandidate[]) {
  const seen = new Set<string>();
  const output: TopicCandidate[] = [];

  for (const candidate of candidates) {
    const key = stableCandidateKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(candidate);
  }

  return output;
}

export function estimateTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4));
}
