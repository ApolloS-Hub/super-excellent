/**
 * Continuous Learning Engine
 * Inspired by everything-claude-code's instinct system + gstack /learn
 * Extracts patterns from completed tasks, builds a knowledge base that compounds
 */

export interface Learning {
  id: string;
  type: "pattern" | "pitfall" | "preference" | "shortcut" | "workaround";
  title: string;
  description: string;
  context: string;
  confidence: number; // 0-1, increases with repeated observations
  occurrences: number;
  tags: string[];
  source: string; // task/conversation that produced this
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
}

export interface LearningStore {
  learnings: Map<string, Learning>;
  version: number;
}

export function createLearningStore(): LearningStore {
  return { learnings: new Map(), version: 1 };
}

export function addLearning(
  store: LearningStore,
  input: Omit<Learning, "id" | "createdAt" | "updatedAt" | "occurrences" | "confidence">,
): Learning {
  // Check for similar existing learning
  const existing = findSimilar(store, input.title, input.tags);
  if (existing) {
    existing.occurrences++;
    existing.confidence = Math.min(1, existing.confidence + 0.1);
    existing.updatedAt = Date.now();
    if (input.description.length > existing.description.length) {
      existing.description = input.description;
    }
    return existing;
  }

  const learning: Learning = {
    ...input,
    id: `learn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    confidence: 0.5,
    occurrences: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  store.learnings.set(learning.id, learning);
  return learning;
}

export function findSimilar(store: LearningStore, title: string, tags: string[]): Learning | null {
  const titleLower = title.toLowerCase();
  for (const [, l] of store.learnings) {
    // Title similarity
    if (l.title.toLowerCase() === titleLower) return l;
    // Tag overlap > 60%
    const overlap = tags.filter(t => l.tags.includes(t)).length;
    if (tags.length > 0 && overlap / tags.length > 0.6 && l.title.toLowerCase().includes(titleLower.split(" ")[0])) {
      return l;
    }
  }
  return null;
}

/** Get relevant learnings for a given context */
export function queryLearnings(
  store: LearningStore,
  tags: string[],
  type?: Learning["type"],
  minConfidence = 0.3,
): Learning[] {
  return Array.from(store.learnings.values())
    .filter(l => {
      if (l.confidence < minConfidence) return false;
      if (type && l.type !== type) return false;
      return tags.some(t => l.tags.includes(t));
    })
    .sort((a, b) => b.confidence - a.confidence);
}

/** Extract learnings from task completion */
export function extractFromCompletion(
  store: LearningStore,
  taskTitle: string,
  taskDescription: string,
  result: "success" | "failure",
  errorMessage?: string,
  tags: string[] = [],
): Learning | null {
  if (result === "failure" && errorMessage) {
    return addLearning(store, {
      type: "pitfall",
      title: `${taskTitle} 失败模式`,
      description: `任务 "${taskTitle}" 失败: ${errorMessage}`,
      context: taskDescription,
      tags: [...tags, "failure", "avoid"],
      source: taskTitle,
    });
  }

  if (result === "success") {
    return addLearning(store, {
      type: "pattern",
      title: `${taskTitle} 成功模式`,
      description: `任务 "${taskTitle}" 成功完成`,
      context: taskDescription,
      tags: [...tags, "success"],
      source: taskTitle,
    });
  }

  return null;
}

/** Prune low-confidence, old learnings */
export function pruneLearnings(store: LearningStore, maxAge = 90 * 24 * 60 * 60 * 1000): number {
  const now = Date.now();
  let pruned = 0;

  for (const [id, l] of store.learnings) {
    const age = now - l.updatedAt;
    if (age > maxAge && l.confidence < 0.4 && l.occurrences <= 1) {
      store.learnings.delete(id);
      pruned++;
    }
  }

  return pruned;
}

/** Serialize for persistence */
export function serializeLearnings(store: LearningStore): string {
  return JSON.stringify({
    version: store.version,
    learnings: Array.from(store.learnings.entries()),
  });
}

export function deserializeLearnings(json: string): LearningStore {
  const data = JSON.parse(json);
  const store = createLearningStore();
  store.version = data.version;
  for (const [id, learning] of data.learnings) {
    store.learnings.set(id, learning);
  }
  return store;
}
