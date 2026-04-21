/**
 * deep-interview.ts — Socratic clarification workflow (oh-my-codex pattern)
 *
 * Scores a task along 6 ambiguity dimensions. While the score stays above
 * the profile threshold, proposes one clarifying question per round.
 * Three challenge modes inject productive friction: contrarian, simplifier,
 * ontologist. Final artifact is a stable spec saved under .omx/specs/.
 */

import { isTauriAvailable, writeFileTauri } from "./tauri-bridge";

export type InterviewProfile = "quick" | "standard" | "deep";
export type ChallengeMode = "contrarian" | "simplifier" | "ontologist";

export interface ProfileConfig {
  threshold: number;
  maxRounds: number;
}

export const PROFILES: Record<InterviewProfile, ProfileConfig> = {
  quick:    { threshold: 0.30, maxRounds: 5  },
  standard: { threshold: 0.20, maxRounds: 12 },
  deep:     { threshold: 0.15, maxRounds: 20 },
};

export interface AmbiguityScore {
  intent: number;       // why — motivation, purpose
  outcome: number;      // what — deliverable shape
  scope: number;        // where/when — boundaries
  constraints: number;  // how — tech/policy limits
  success: number;      // metrics, acceptance criteria
  context: number;      // surrounding systems, audience
  overall: number;      // weighted mean
}

const WEIGHTS: Record<keyof Omit<AmbiguityScore, "overall">, number> = {
  intent:      0.25,
  outcome:     0.20,
  scope:       0.15,
  constraints: 0.15,
  success:     0.15,
  context:     0.10,
};

export interface InterviewRound {
  round: number;
  question: string;
  mode?: ChallengeMode;
  answer?: string;
  scoreAfter?: AmbiguityScore;
}

export interface InterviewState {
  id: string;
  topic: string;
  profile: InterviewProfile;
  rounds: InterviewRound[];
  score: AmbiguityScore;
  converged: boolean;
  startedAt: number;
  finishedAt?: number;
}

/**
 * Heuristic scoring — inspects the raw topic + answers to estimate how
 * vague each dimension still is. Returns values in [0,1] where 1 = fully
 * ambiguous and 0 = fully specified. The real UX will call an LLM to
 * refine these numbers; this heuristic is a deterministic fallback.
 */
export function scoreAmbiguity(topic: string, answers: string[] = []): AmbiguityScore {
  const text = [topic, ...answers].join(" ").toLowerCase();
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  const hasSignal = (patterns: RegExp[]) => patterns.some(r => r.test(text));

  const intent = hasSignal([/because|so that|in order to|goal|motivation/]) ? 0.2 : 0.7;
  const outcome = hasSignal([/deliver|output|produce|return|file|component|api|endpoint/]) ? 0.2 : 0.7;
  const scope = hasSignal([/only|just|limited to|scope|within|exclude|no more|at most/]) ? 0.2 : 0.7;
  const constraints = hasSignal([/must|cannot|required|limit|budget|within|timeout|tech stack/]) ? 0.2 : 0.7;
  const success = hasSignal([/metric|pass|accept|criteria|when done|success|test/]) ? 0.2 : 0.7;
  const context = hasSignal([/user|team|project|existing|current|production|prod|staging/]) ? 0.2 : 0.7;

  // Give topics that have gotten many answers a small boost
  const answerBoost = Math.min(0.3, answers.length * 0.04);
  const tooShortPenalty = wordCount < 6 ? 0.1 : 0;

  const clamp = (n: number) => Math.max(0, Math.min(1, n - answerBoost + tooShortPenalty));
  const dims = {
    intent: clamp(intent),
    outcome: clamp(outcome),
    scope: clamp(scope),
    constraints: clamp(constraints),
    success: clamp(success),
    context: clamp(context),
  };

  let overall = 0;
  for (const [k, w] of Object.entries(WEIGHTS)) {
    overall += dims[k as keyof typeof dims] * w;
  }

  return { ...dims, overall };
}

/**
 * Pick the weakest (most ambiguous) dimension to target next.
 */
export function weakestDimension(score: AmbiguityScore): keyof Omit<AmbiguityScore, "overall"> {
  const entries = (Object.keys(WEIGHTS) as Array<keyof typeof WEIGHTS>)
    .map(k => [k, score[k]] as const);
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

const QUESTION_TEMPLATES: Record<keyof Omit<AmbiguityScore, "overall">, string[]> = {
  intent: [
    "What happens if we don't do this? What problem disappears?",
    "Who benefits most from this, and in what observable way?",
  ],
  outcome: [
    "Describe the final artifact in one sentence — file, command, UI, API?",
    "If this shipped, what exactly would I hand to a user?",
  ],
  scope: [
    "What's explicitly out of scope for this first pass?",
    "Which users/files/flows are we NOT touching?",
  ],
  constraints: [
    "What technical or policy constraints must we respect (stack, latency, deps)?",
    "Anything we're forbidden from changing?",
  ],
  success: [
    "How will we know this is done — a test, a metric, a human judgment?",
    "What does 'wrong' look like for this feature?",
  ],
  context: [
    "What existing code/system does this plug into?",
    "Who else depends on this behavior right now?",
  ],
};

const CHALLENGE_PROMPTS: Record<ChallengeMode, (topic: string) => string> = {
  contrarian: (topic) =>
    `Contrarian: what if the opposite of "${topic}" were the right move? What premise are we assuming without evidence?`,
  simplifier: (topic) =>
    `Simplifier: what is the absolute smallest version of "${topic}" that still delivers value? Strip every optional piece.`,
  ontologist: (topic) =>
    `Ontologist: what category is "${topic}" — feature, refactor, policy, experiment? Mis-classifying it changes everything.`,
};

/**
 * Choose the next question: either target the weakest dim, or (every 3rd
 * round) inject a challenge-mode prompt for productive friction.
 */
export function nextQuestion(state: InterviewState): { question: string; mode?: ChallengeMode } {
  const round = state.rounds.length + 1;
  if (round % 3 === 0) {
    const modes: ChallengeMode[] = ["contrarian", "simplifier", "ontologist"];
    const mode = modes[Math.floor(round / 3) % modes.length];
    return { question: CHALLENGE_PROMPTS[mode](state.topic), mode };
  }
  const dim = weakestDimension(state.score);
  const templates = QUESTION_TEMPLATES[dim];
  const question = templates[round % templates.length];
  return { question };
}

export function startInterview(topic: string, profile: InterviewProfile = "standard"): InterviewState {
  const score = scoreAmbiguity(topic, []);
  return {
    id: `iv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    topic,
    profile,
    rounds: [],
    score,
    converged: false,
    startedAt: Date.now(),
  };
}

export function recordAnswer(state: InterviewState, question: string, answer: string, mode?: ChallengeMode): InterviewState {
  const answers = [...state.rounds.map(r => r.answer).filter(Boolean) as string[], answer];
  const newScore = scoreAmbiguity(state.topic, answers);
  const cfg = PROFILES[state.profile];
  const newRound: InterviewRound = {
    round: state.rounds.length + 1,
    question,
    mode,
    answer,
    scoreAfter: newScore,
  };
  const rounds = [...state.rounds, newRound];
  const converged = newScore.overall <= cfg.threshold || rounds.length >= cfg.maxRounds;
  return {
    ...state,
    rounds,
    score: newScore,
    converged,
    finishedAt: converged ? Date.now() : undefined,
  };
}

/**
 * Emit the final spec document as markdown. Follows a stable template so
 * downstream tools (Ralplan, Ralph) can parse it back out.
 */
export function renderSpec(state: InterviewState): string {
  const lines = [
    `# Spec — ${state.topic}`,
    "",
    `- **Profile**: \`${state.profile}\``,
    `- **Rounds**: ${state.rounds.length}`,
    `- **Converged**: ${state.converged ? "✅" : "❌"}`,
    `- **Final ambiguity**: ${state.score.overall.toFixed(2)}`,
    "",
    "## Dimensions",
    "",
    "| Dimension | Score |",
    "|---|---|",
  ];
  for (const k of Object.keys(WEIGHTS) as Array<keyof typeof WEIGHTS>) {
    lines.push(`| ${k} | ${state.score[k].toFixed(2)} |`);
  }
  lines.push("", "## Q&A");
  for (const r of state.rounds) {
    const tag = r.mode ? ` _(${r.mode})_` : "";
    lines.push("", `### Round ${r.round}${tag}`, "", `**Q:** ${r.question}`, "", `**A:** ${r.answer || "(no answer)"}`);
  }
  return lines.join("\n");
}

export async function saveSpec(state: InterviewState, workDir: string): Promise<string | null> {
  if (!isTauriAvailable() || !workDir) return null;
  const path = `${workDir}/.omx/specs/${state.id}.md`;
  try {
    await writeFileTauri(path, renderSpec(state));
    return path;
  } catch {
    return null;
  }
}
