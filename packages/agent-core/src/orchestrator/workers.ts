/**
 * Legacy worker roster adapter.
 *
 * The original Secretary pipeline consumed a slim WorkerRole[] shape from
 * `types.ts`, while the richer role system now lives in `roles.ts`.
 * This file keeps the old API surface, but derives its data from the canonical
 * 20-role registry so we do not maintain two drifting worker lists.
 */
import type { WorkerRole } from "./types.js";
import { getAllRoles } from "./roles.js";

export const WORKER_ROLES: WorkerRole[] = getAllRoles().map((role) => ({
  id: role.id,
  name: role.nameEn,
  nameZh: role.name,
  description: role.description,
  systemPrompt: role.systemPrompt,
  allowedTools: [...role.tools],
  expertise: [...role.expertise],
}));

export function getWorkerById(id: string): WorkerRole | undefined {
  return WORKER_ROLES.find((worker) => worker.id === id);
}

export function getWorkersByExpertise(keywords: string[]): WorkerRole[] {
  const normalizedKeywords = keywords.map(normalizeKeyword).filter(Boolean);

  return WORKER_ROLES.filter((worker) =>
    worker.expertise.some((expertise) => {
      const normalizedExpertise = normalizeKeyword(expertise);
      return normalizedKeywords.some((keyword) =>
        normalizedExpertise.includes(keyword) || keyword.includes(normalizedExpertise),
      );
    }),
  );
}

function normalizeKeyword(value: string): string {
  return value.toLowerCase().replace(/[-_\s]+/g, "-").trim();
}
