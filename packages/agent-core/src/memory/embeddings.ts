/**
 * Embedding providers for vector memory.
 *
 * Supports two modes:
 * - OpenAI API embeddings (text-embedding-3-small) for production-grade semantics
 * - Local hash-based embeddings (no API needed) as an always-available fallback
 *
 * The local approach uses FNV-1a hashing over character trigrams with TF-IDF-like
 * weighting, synonym expansion, and stopword removal to produce deterministic
 * 256-dimension vectors that are materially better than raw keyword overlap.
 */

/* ------------------------------------------------------------------ */
/*  Interfaces                                                         */
/* ------------------------------------------------------------------ */

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  dimensions: number;
}

/* ------------------------------------------------------------------ */
/*  OpenAI embeddings                                                  */
/* ------------------------------------------------------------------ */

interface OpenAIEmbeddingsConfig {
  apiKey: string;
  model?: string;
  baseURL?: string;
}

export class OpenAIEmbeddings implements EmbeddingProvider {
  readonly dimensions: number;
  private apiKey: string;
  private model: string;
  private baseURL: string;

  constructor(config: OpenAIEmbeddingsConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? "text-embedding-3-small";
    this.baseURL = (config.baseURL ?? "https://api.openai.com/v1").replace(
      /\/+$/,
      "",
    );
    // text-embedding-3-small produces 1536-d vectors by default
    this.dimensions = this.model === "text-embedding-3-large" ? 3072 : 1536;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const response = await fetch(`${this.baseURL}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input: texts,
        model: this.model,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "unknown error");
      throw new Error(
        `OpenAI embeddings request failed (${response.status}): ${errorBody}`,
      );
    }

    const json = (await response.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    // The API may return results out of order — sort by index.
    const sorted = json.data.sort((a, b) => a.index - b.index);
    return sorted.map((d) => d.embedding);
  }
}

/* ------------------------------------------------------------------ */
/*  Local (offline) embeddings                                         */
/* ------------------------------------------------------------------ */

const LOCAL_DIMENSIONS = 256;
const MAX_KEYWORDS = 64;
const TRIGRAM_CAP = MAX_KEYWORDS * 4;

/**
 * Hash-based local embedding provider.
 *
 * Designed to work without any network calls while still producing useful
 * similarity signals via:
 * - Character trigram hashing for fuzzy / substring matching
 * - TF-IDF-like weighting (keyword weight > synonym weight > n-gram weight)
 * - Stopword removal (English + Chinese)
 * - CJK character handling (single-char and bigram features)
 * - Synonym expansion for common developer terms
 */
export class LocalEmbeddings implements EmbeddingProvider {
  readonly dimensions = LOCAL_DIMENSIONS;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => embedTextLocal(text));
  }
}

/* ------------------------------------------------------------------ */
/*  Cosine similarity                                                  */
/* ------------------------------------------------------------------ */

export function cosineSimilarity(a: number[], b: number[]): number {
  const size = Math.min(a.length, b.length);
  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < size; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    magA += ai * ai;
    magB += bi * bi;
  }

  if (!magA || !magB) return 0;
  return dot / Math.sqrt(magA * magB);
}

/* ------------------------------------------------------------------ */
/*  Factory                                                            */
/* ------------------------------------------------------------------ */

export interface EmbeddingProviderConfig {
  type?: "openai" | "local";
  apiKey?: string;
  model?: string;
  baseURL?: string;
}

/**
 * Create an embedding provider.
 *
 * - `type: "openai"` with a valid `apiKey` → OpenAI API embeddings
 * - Otherwise → deterministic local embeddings (no network required)
 */
export function createEmbeddingProvider(
  config?: EmbeddingProviderConfig,
): EmbeddingProvider {
  if (config?.type === "openai" && config.apiKey) {
    return new OpenAIEmbeddings({
      apiKey: config.apiKey,
      model: config.model,
      baseURL: config.baseURL,
    });
  }
  return new LocalEmbeddings();
}

/* ================================================================== */
/*  Internal helpers — local embedding pipeline                        */
/* ================================================================== */

/* ---------- synonym tables ---------- */

const CANONICAL_SYNONYMS: Record<string, string[]> = {
  typescript: ["ts", "typed", "javascript", "typedjs", "statictyping"],
  javascript: ["js", "ecmascript", "frontend"],
  python: ["py", "scripting", "automation"],
  bug: ["issue", "defect", "problem", "error"],
  fix: ["repair", "resolve", "patch", "solution"],
  deploy: ["release", "ship", "publish", "上线", "发布"],
  auth: ["authentication", "login", "signin", "permission"],
  memory: ["recall", "context", "history"],
  vector: ["embedding", "semantic", "similarity"],
  test: ["testing", "spec", "assertion", "qa"],
  database: ["db", "sql", "postgres", "mysql", "sqlite", "mongo"],
  api: ["endpoint", "route", "rest", "graphql"],
  config: ["configuration", "settings", "options", "preferences"],
  cache: ["caching", "memoize", "memoization", "store"],
  客服: ["支持", "工单", "helpdesk", "support"],
  风控: ["风险", "fraud", "compliance", "anomaly"],
  运营: ["增长", "留存", "渠道", "marketing"],
};

const SYNONYM_TO_CANONICAL = buildSynonymMap(CANONICAL_SYNONYMS);

/* ---------- stopwords ---------- */

const STOP_WORDS = new Set([
  // English
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "shall", "can", "to", "of", "in", "for",
  "on", "with", "at", "by", "from", "as", "into", "about", "like",
  "through", "after", "over", "between", "out", "against", "during",
  "without", "before", "under", "around", "among", "and", "but", "or",
  "not", "no", "if", "then", "else", "when", "up", "so", "than",
  "too", "very", "just", "that", "this", "it", "its", "my", "your",
  "our", "their", "we", "they", "he", "she", "them", "you", "me",
  // Chinese
  "我", "你", "他", "她", "它", "的", "了", "在", "是", "有", "和",
  "与", "也", "都", "而", "及", "或", "但", "不", "这", "那", "就",
]);

/* ---------- FNV-1a hash ---------- */

function fnv1a(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash | 0;
}

/* ---------- text normalization ---------- */

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2019']/g, "")
    .replace(/[^\w\u4e00-\u9fff\s-]/g, " ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ---------- synonym helpers ---------- */

function buildSynonymMap(source: Record<string, string[]>): Map<string, string> {
  const map = new Map<string, string>();
  for (const [canonical, aliases] of Object.entries(source)) {
    map.set(canonical, canonical);
    for (const alias of aliases) {
      map.set(alias, canonical);
    }
  }
  return map;
}

function canonicalizeToken(token: string): string {
  return SYNONYM_TO_CANONICAL.get(token) ?? token;
}

function expandToken(token: string): string[] {
  const canonical = canonicalizeToken(token);
  return CANONICAL_SYNONYMS[canonical] ?? [];
}

/* ---------- keyword extraction ---------- */

function extractKeywords(text: string): string[] {
  const normalized = normalizeText(text);
  const words = normalized
    .split(/\s+/)
    .map((w) => canonicalizeToken(w))
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));

  const unique = new Set<string>();
  for (const word of words) {
    unique.add(word);
    for (const alias of expandToken(word)) {
      if (!STOP_WORDS.has(alias)) unique.add(alias);
    }
    if (unique.size >= MAX_KEYWORDS) break;
  }

  return [...unique].slice(0, MAX_KEYWORDS);
}

/* ---------- character n-gram extraction ---------- */

function extractCharacterNgrams(text: string): string[] {
  const compact = text.replace(/\s+/g, "");
  const grams: string[] = [];

  for (let i = 0; i < compact.length; i++) {
    const char = compact[i];
    if (!char) continue;

    // Unigrams (useful for CJK where a single character carries meaning)
    grams.push(char);

    // Bigrams
    if (i + 1 < compact.length) grams.push(compact.slice(i, i + 2));

    // Trigrams — the primary fuzzy-matching signal
    if (i + 2 < compact.length) grams.push(compact.slice(i, i + 3));

    if (grams.length >= TRIGRAM_CAP) break;
  }

  return grams;
}

/* ---------- TF-IDF-like weighting into the vector ---------- */

/**
 * Project a feature into two slots of the vector with a signed weight.
 * Using two slots (primary + secondary at half-weight) reduces hash
 * collision impact and spreads information across the vector space.
 */
function addWeightedFeature(
  vector: number[],
  feature: string,
  weight: number,
): void {
  const seed = fnv1a(feature);
  const index = Math.abs(seed) % LOCAL_DIMENSIONS;
  const sign = seed % 2 === 0 ? 1 : -1;
  vector[index]! += sign * weight;

  const secondaryIndex = Math.abs(seed * 31) % LOCAL_DIMENSIONS;
  vector[secondaryIndex]! += sign * weight * 0.5;
}

/* ---------- vector normalization ---------- */

function normalizeVector(vector: number[]): number[] {
  let sumSquares = 0;
  for (const v of vector) sumSquares += v * v;
  const magnitude = Math.sqrt(sumSquares);
  if (!magnitude) return vector.map(() => 0);
  return vector.map((v) => Number((v / magnitude).toFixed(6)));
}

/* ---------- main local embed function ---------- */

function embedTextLocal(text: string): number[] {
  const vector = new Array<number>(LOCAL_DIMENSIONS).fill(0);
  const normalized = normalizeText(text);
  const keywords = extractKeywords(text);
  const grams = extractCharacterNgrams(normalized);

  // TF-IDF-like tier weighting:
  //   keywords  → weight 3 (highest signal)
  //   synonyms  → weight 2
  //   trigrams   → weight 1 (fuzzy / positional)

  for (const token of keywords) {
    addWeightedFeature(vector, `kw:${token}`, 3);
    for (const alias of expandToken(token)) {
      addWeightedFeature(vector, `alias:${alias}`, 2);
    }
  }

  for (const gram of grams) {
    addWeightedFeature(vector, `ng:${gram}`, 1);
  }

  return normalizeVector(vector);
}
