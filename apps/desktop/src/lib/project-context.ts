/**
 * Project Context — auto-detect and understand the user's project
 * Reads package.json, README, AGENTS.md, etc. to build context
 */

export interface ProjectInfo {
  name: string;
  type: string;          // "nodejs" | "python" | "rust" | "go" | "unknown"
  rootPath: string;
  description?: string;
  dependencies?: string[];
  scripts?: Record<string, string>;
  readme?: string;
  agentsMd?: string;
}

/**
 * Detect project from a directory
 */
export async function detectProject(dirPath: string): Promise<ProjectInfo | null> {
  try {
    const { isTauriAvailable } = await import("./tauri-bridge");
    if (!isTauriAvailable()) return null;
    const { agentExecuteTool } = await import("./tauri-bridge");

    // Check what config files exist
    const lsResult = await agentExecuteTool("Bash", {
      command: `cd "${dirPath}" 2>/dev/null && ls package.json tsconfig.json Cargo.toml go.mod pyproject.toml README.md AGENTS.md .gitignore 2>/dev/null || echo "NOT_A_PROJECT"`,
    });

    if (lsResult.includes("NOT_A_PROJECT")) return null;

    const info: ProjectInfo = {
      name: dirPath.split("/").pop() || "unknown",
      type: "unknown",
      rootPath: dirPath,
    };

    // Detect type
    if (lsResult.includes("package.json")) {
      info.type = lsResult.includes("tsconfig.json") ? "typescript" : "nodejs";
      try {
        const pkg = await agentExecuteTool("FileRead", { path: `${dirPath}/package.json` });
        const parsed = JSON.parse(pkg);
        info.name = parsed.name || info.name;
        info.description = parsed.description;
        info.scripts = parsed.scripts;
        info.dependencies = [
          ...Object.keys(parsed.dependencies || {}),
          ...Object.keys(parsed.devDependencies || {}),
        ].slice(0, 20);
      } catch { /* ignore */ }
    } else if (lsResult.includes("Cargo.toml")) {
      info.type = "rust";
    } else if (lsResult.includes("go.mod")) {
      info.type = "go";
    } else if (lsResult.includes("pyproject.toml")) {
      info.type = "python";
    }

    // Read README (first 2000 chars)
    if (lsResult.includes("README.md")) {
      try {
        const readme = await agentExecuteTool("FileRead", { path: `${dirPath}/README.md` });
        info.readme = readme.slice(0, 2000);
      } catch { /* ignore */ }
    }

    // Read AGENTS.md
    if (lsResult.includes("AGENTS.md")) {
      try {
        const agents = await agentExecuteTool("FileRead", { path: `${dirPath}/AGENTS.md` });
        info.agentsMd = agents.slice(0, 3000);
      } catch { /* ignore */ }
    }

    return info;
  } catch {
    return null;
  }
}

/**
 * Build project context for system prompt
 */
export function buildProjectPrompt(project: ProjectInfo): string {
  let prompt = `\n\n## 当前项目\n- 名称: ${project.name}\n- 类型: ${project.type}\n- 路径: ${project.rootPath}`;
  if (project.description) prompt += `\n- 描述: ${project.description}`;
  if (project.scripts) {
    const scripts = Object.entries(project.scripts).slice(0, 10);
    prompt += `\n- 脚本: ${scripts.map(([k, v]) => `${k}=${v}`).join(", ")}`;
  }
  if (project.dependencies?.length) {
    prompt += `\n- 依赖: ${project.dependencies.join(", ")}`;
  }
  if (project.agentsMd) {
    prompt += `\n\n### AGENTS.md\n${project.agentsMd}`;
  }
  return prompt;
}

let cachedProject: ProjectInfo | null = null;

export function getCachedProject(): ProjectInfo | null {
  return cachedProject;
}

export function setCachedProject(p: ProjectInfo | null): void {
  cachedProject = p;
}
