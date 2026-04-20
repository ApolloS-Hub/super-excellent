import type { ToolDef, ToolMeta, TranslateFn } from "./types";

export function definition(t: TranslateFn): ToolDef {
  return {
    type: "function",
    function: {
      name: "bash",
      description: t("tools.bashDesc"),
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: t("tools.bashCommand") },
          timeout: { type: "number", description: t("tools.bashTimeout") },
          truncate_output: { type: "number", description: t("tools.bashTruncate") },
        },
        required: ["command"],
      },
    },
  };
}

export const meta: ToolMeta = {
  permission: "dangerous",
  category: "process",
  searchHint: "execute shell command run script terminal",
  maxResultChars: 100_000,
};

export const rustName = "Bash";

// ═══════════ Dangerous Command Detection ═══════════

const DANGEROUS_PATTERNS = [
  /rm\s+(-rf?\s+)?[/~]/, /mkfs/, /dd\s+if=/, />\s*\/dev\//, /chmod\s+-R\s+777\s+\//,
  /shutdown/, /reboot/, /halt/, /poweroff/,
  /DROP\s+(DATABASE|TABLE)/i, /DELETE\s+FROM/i, /TRUNCATE/i,
  /curl\s*\|.*sh/, /wget\s*\|.*sh/, /eval\s*\$\(curl/,
  /sudo\s+/, /su\s+-/,
  /git\s+push.*--force/, /git\s+push.*-f/,
];

export function isDangerousCommand(command: string): boolean {
  return DANGEROUS_PATTERNS.some(p => p.test(command));
}

export function getDangerDescription(command: string, t: TranslateFn): string {
  if (/rm\s/.test(command)) return t("tools.dangerDeleteFiles");
  if (/sudo/.test(command)) return t("tools.dangerSudo");
  if (/git\s+push.*(-f|--force)/.test(command)) return t("tools.dangerForcePush");
  if (/DROP|DELETE|TRUNCATE/i.test(command)) return t("tools.dangerDbDestruct");
  if (/curl.*\|\s*(sh|bash)/.test(command)) return t("tools.dangerRemoteScript");
  return t("tools.dangerPotential");
}
