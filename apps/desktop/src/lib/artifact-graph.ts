/**
 * Artifact Graph — Change Propagation Engine
 *
 * Maintains a DAG of artifacts (tasks, plans, docs, schedules) and their
 * dependencies. When an upstream artifact changes, all downstream dependents
 * are marked stale and optionally re-generated.
 *
 * Inspired by product-playbook's "modify upstream → cascade downstream" pattern.
 */
import { emitAgentEvent } from "./event-bus";

// ── Types ──

export interface Artifact {
  id: string;
  type: "task" | "plan" | "schedule" | "document" | "decision" | "metric";
  label: string;
  content: string;
  version: number;
  stale: boolean;
  createdAt: number;
  updatedAt: number;
  owner?: string;       // worker ID that produced this
  sourceStep?: string;  // scenario step ID that produced this
}

export interface Dependency {
  from: string;  // upstream artifact ID
  to: string;    // downstream artifact ID
  relation: "derives-from" | "blocks" | "informs" | "contradicts";
}

// ── Storage ──

const _artifacts = new Map<string, Artifact>();
const _edges: Dependency[] = [];
const _listeners: Array<(event: PropagationEvent) => void> = [];

export interface PropagationEvent {
  type: "stale" | "updated" | "created" | "deleted";
  artifactId: string;
  cascadedFrom?: string;
}

// ── Core API ──

export function createArtifact(
  id: string,
  type: Artifact["type"],
  label: string,
  content: string,
  owner?: string,
  sourceStep?: string,
): Artifact {
  const artifact: Artifact = {
    id, type, label, content,
    version: 1,
    stale: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    owner,
    sourceStep,
  };
  _artifacts.set(id, artifact);
  notify({ type: "created", artifactId: id });
  return artifact;
}

export function getArtifact(id: string): Artifact | undefined {
  return _artifacts.get(id);
}

export function getAllArtifacts(): Artifact[] {
  return Array.from(_artifacts.values());
}

export function getStaleArtifacts(): Artifact[] {
  return getAllArtifacts().filter(a => a.stale);
}

export function updateArtifact(id: string, newContent: string): Artifact | null {
  const a = _artifacts.get(id);
  if (!a) return null;
  a.content = newContent;
  a.version++;
  a.stale = false;
  a.updatedAt = Date.now();
  notify({ type: "updated", artifactId: id });

  // Cascade: mark all downstream dependents as stale
  propagateStale(id);

  return a;
}

export function deleteArtifact(id: string): void {
  _artifacts.delete(id);
  // Remove edges involving this artifact
  for (let i = _edges.length - 1; i >= 0; i--) {
    if (_edges[i].from === id || _edges[i].to === id) _edges.splice(i, 1);
  }
  notify({ type: "deleted", artifactId: id });
}

// ── Dependency management ──

export function addDependency(from: string, to: string, relation: Dependency["relation"] = "derives-from"): void {
  if (_edges.some(e => e.from === from && e.to === to)) return; // no duplicates
  _edges.push({ from, to, relation });
}

export function removeDependency(from: string, to: string): void {
  const idx = _edges.findIndex(e => e.from === from && e.to === to);
  if (idx >= 0) _edges.splice(idx, 1);
}

export function getUpstream(id: string): Artifact[] {
  return _edges
    .filter(e => e.to === id)
    .map(e => _artifacts.get(e.from))
    .filter((a): a is Artifact => !!a);
}

export function getDownstream(id: string): Artifact[] {
  return _edges
    .filter(e => e.from === id)
    .map(e => _artifacts.get(e.to))
    .filter((a): a is Artifact => !!a);
}

export function getDependencyGraph(): { artifacts: Artifact[]; edges: Dependency[] } {
  return { artifacts: getAllArtifacts(), edges: [..._edges] };
}

// ── Propagation ──

function propagateStale(changedId: string): void {
  const visited = new Set<string>();
  const queue = [changedId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    for (const edge of _edges) {
      if (edge.from === current && !visited.has(edge.to)) {
        const downstream = _artifacts.get(edge.to);
        if (downstream && !downstream.stale) {
          downstream.stale = true;
          downstream.updatedAt = Date.now();
          notify({ type: "stale", artifactId: edge.to, cascadedFrom: changedId });
          queue.push(edge.to);
        }
      }
    }
  }

  const staleCount = getStaleArtifacts().length;
  if (staleCount > 0) {
    emitAgentEvent({
      type: "intent_analysis",
      intentType: "propagation",
      text: `Artifact "${changedId}" changed → ${staleCount} downstream artifact(s) marked stale`,
    });
  }
}

/**
 * Re-generate all stale artifacts in topological order.
 * The regenerator function receives the artifact and its fresh upstream content.
 */
export async function regenerateStale(
  regenerate: (artifact: Artifact, upstreamContent: string) => Promise<string>,
): Promise<Artifact[]> {
  const stale = topologicalSort(getStaleArtifacts().map(a => a.id));
  const updated: Artifact[] = [];

  for (const id of stale) {
    const a = _artifacts.get(id);
    if (!a || !a.stale) continue;

    const upstream = getUpstream(id)
      .map(u => `[${u.label}]: ${u.content}`)
      .join("\n\n");

    try {
      const newContent = await regenerate(a, upstream);
      a.content = newContent;
      a.version++;
      a.stale = false;
      a.updatedAt = Date.now();
      updated.push(a);
      notify({ type: "updated", artifactId: id });
    } catch {
      // Leave stale if regeneration fails
    }
  }

  return updated;
}

// ── Topological sort (Kahn's algorithm) ──

function topologicalSort(ids: string[]): string[] {
  const idSet = new Set(ids);
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const id of ids) {
    inDegree.set(id, 0);
    adj.set(id, []);
  }
  for (const e of _edges) {
    if (idSet.has(e.from) && idSet.has(e.to)) {
      adj.get(e.from)!.push(e.to);
      inDegree.set(e.to, (inDegree.get(e.to) || 0) + 1);
    }
  }

  const queue = ids.filter(id => (inDegree.get(id) || 0) === 0);
  const result: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    result.push(node);
    for (const next of adj.get(node) || []) {
      const deg = (inDegree.get(next) || 1) - 1;
      inDegree.set(next, deg);
      if (deg === 0) queue.push(next);
    }
  }
  return result;
}

// ── Listeners ──

export function onPropagation(handler: (event: PropagationEvent) => void): () => void {
  _listeners.push(handler);
  return () => {
    const idx = _listeners.indexOf(handler);
    if (idx >= 0) _listeners.splice(idx, 1);
  };
}

function notify(event: PropagationEvent): void {
  for (const h of _listeners) { try { h(event); } catch { /* */ } }
}

// ── Integration with scenario engine ──

export function linkScenarioArtifacts(scenarioId: string, stepOutputs: Array<{ stepId: string; content: string }>): void {
  let prevId: string | null = null;
  for (const { stepId, content } of stepOutputs) {
    const id = `${scenarioId}:${stepId}`;
    createArtifact(id, "document", stepId, content, undefined, stepId);
    if (prevId) addDependency(prevId, id);
    prevId = id;
  }
}
