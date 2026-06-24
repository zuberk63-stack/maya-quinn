export function parseEmbedding(value: unknown): number[] | null {
  if (Array.isArray(value)) {
    return value.map(Number).filter(Number.isFinite);
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (!trimmed) {
    return null;
  }

  const numbers = trimmed.split(",").map((part) => Number(part.trim()));
  return numbers.every(Number.isFinite) ? numbers : null;
}

export function cosineSimilarity(left: number[], right: number[]) {
  if (left.length === 0 || left.length !== right.length) {
    return 0;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export function toVectorLiteral(values: number[]) {
  return `[${values.map((value) => Number(value.toFixed(8))).join(",")}]`;
}
