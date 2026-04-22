/**
 * Environment Scanner — Build Mode
 *
 * Proactively scans the user's environment before planning tasks:
 * project directories, git repos, tech stacks, recent activity.
 * Injects real-world constraints into planning prompts.
 *
 * Inspired by product-playbook's "Build Mode scans codebase while planning" pattern.
 */
import { emitAgentEvent } from "./event-bus";

// ── Types ──

export interface EnvSnapshot {
  timestamp: number;
  projects: ProjectInfo[];
  systemInfo: SystemInfo;
  recentActivity: string[];
}

export interface ProjectInfo {
  path: string;
  name: string;
  techStack: string[];
  packageManager?: string;
  lastCommit?: string;
  branchName?: string;
  fileCount?: number;
  hasTests: boolean;
  hasCI: boolean;
  mainLanguage?: string;
}

export interface SystemInfo {
  platform: string;
  shell: string;
  nodeVersion?: string;
  gitVersion?: string;
}

// ── Scanner ──

let _lastSnapshot: EnvSnapshot | null = null;

async function runCommand(cmd: string): Promise<string> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<string>("execute_command", { program: "sh", args: ["-c", cmd], env: {} });
  } catch {
    return "";
  }
}

export async function scanEnvironment(projectPaths?: string[]): Promise<EnvSnapshot> {
  emitAgentEvent({ type: "worker_activate", worker: "env_scanner", text: "Scanning environment..." });

  const projects: ProjectInfo[] = [];
  const paths = projectPaths || await discoverProjects();

  for (const p of paths.slice(0, 5)) { // max 5 projects
    const info = await scanProject(p);
    if (info) projects.push(info);
  }

  const systemInfo = await scanSystem();
  const recentActivity = await getRecentActivity();

  const snapshot: EnvSnapshot = {
    timestamp: Date.now(),
    projects,
    systemInfo,
    recentActivity,
  };

  _lastSnapshot = snapshot;

  emitAgentEvent({ type: "worker_complete", worker: "env_scanner", text: `Scanned ${projects.length} projects` });

  return snapshot;
}

async function discoverProjects(): Promise<string[]> {
  const home = await runCommand("echo $HOME");
  if (!home.trim()) return [];

  // Look for common project directories
  const candidates = [
    `${home.trim()}/projects`,
    `${home.trim()}/workspace`,
    `${home.trim()}/code`,
    `${home.trim()}/dev`,
    `${home.trim()}/src`,
    ".",
  ];

  const found: string[] = [];
  for (const dir of candidates) {
    const exists = await runCommand(`test -d "${dir}" && echo yes`);
    if (exists.trim() === "yes") {
      const subdirs = await runCommand(`find "${dir}" -maxdepth 2 -name ".git" -type d 2>/dev/null | head -5`);
      for (const gitDir of subdirs.trim().split("\n").filter(Boolean)) {
        found.push(gitDir.replace("/.git", ""));
      }
    }
    if (found.length >= 5) break;
  }

  return found;
}

async function scanProject(path: string): Promise<ProjectInfo | null> {
  const name = path.split("/").pop() || path;
  const techStack: string[] = [];
  let packageManager: string | undefined;
  let hasTests = false;
  let hasCI = false;
  let mainLanguage: string | undefined;

  // Detect tech stack from config files
  const files = await runCommand(`ls -1 "${path}" 2>/dev/null`);
  const fileList = files.trim().split("\n");

  if (fileList.includes("package.json")) {
    techStack.push("Node.js");
    const pkg = await runCommand(`cat "${path}/package.json" 2>/dev/null | head -50`);
    if (pkg.includes("react")) techStack.push("React");
    if (pkg.includes("vue")) techStack.push("Vue");
    if (pkg.includes("next")) techStack.push("Next.js");
    if (pkg.includes("typescript")) techStack.push("TypeScript");
    if (pkg.includes("vitest") || pkg.includes("jest")) hasTests = true;
  }
  if (fileList.includes("pnpm-lock.yaml")) packageManager = "pnpm";
  else if (fileList.includes("yarn.lock")) packageManager = "yarn";
  else if (fileList.includes("package-lock.json")) packageManager = "npm";
  if (fileList.includes("Cargo.toml")) { techStack.push("Rust"); mainLanguage = "Rust"; }
  if (fileList.includes("go.mod")) { techStack.push("Go"); mainLanguage = "Go"; }
  if (fileList.includes("requirements.txt") || fileList.includes("pyproject.toml")) { techStack.push("Python"); mainLanguage = "Python"; }
  if (fileList.includes("tauri.conf.json") || fileList.includes("src-tauri")) techStack.push("Tauri");
  if (fileList.includes("docker-compose.yml") || fileList.includes("Dockerfile")) techStack.push("Docker");
  if (fileList.some(f => f.startsWith(".github"))) hasCI = true;
  if (fileList.includes("__tests__") || fileList.includes("tests") || fileList.includes("test")) hasTests = true;

  if (!mainLanguage && techStack.includes("TypeScript")) mainLanguage = "TypeScript";
  else if (!mainLanguage && techStack.includes("Node.js")) mainLanguage = "JavaScript";

  // Git info
  const lastCommit = (await runCommand(`cd "${path}" && git log --oneline -1 2>/dev/null`)).trim();
  const branchName = (await runCommand(`cd "${path}" && git branch --show-current 2>/dev/null`)).trim();

  // File count
  const countStr = (await runCommand(`find "${path}" -type f -not -path "*/.git/*" -not -path "*/node_modules/*" 2>/dev/null | wc -l`)).trim();
  const fileCount = parseInt(countStr) || 0;

  return {
    path, name, techStack, packageManager,
    lastCommit: lastCommit || undefined,
    branchName: branchName || undefined,
    fileCount,
    hasTests, hasCI, mainLanguage,
  };
}

async function scanSystem(): Promise<SystemInfo> {
  const platform = (await runCommand("uname -s")).trim() || "unknown";
  const shell = (await runCommand("echo $SHELL")).trim() || "unknown";
  const nodeVersion = (await runCommand("node --version 2>/dev/null")).trim() || undefined;
  const gitVersion = (await runCommand("git --version 2>/dev/null")).trim()?.replace("git version ", "") || undefined;

  return { platform, shell, nodeVersion, gitVersion };
}

async function getRecentActivity(): Promise<string[]> {
  const activity: string[] = [];

  // Recent git commits across discovered projects
  const home = await runCommand("echo $HOME");
  const recentCommits = await runCommand(
    `cd "${home.trim()}" && find . -maxdepth 3 -name ".git" -type d 2>/dev/null | head -3 | while read d; do dir=$(dirname "$d"); echo "[$dir] $(cd "$dir" && git log --oneline -1 2>/dev/null)"; done`
  );
  for (const line of recentCommits.trim().split("\n").filter(Boolean)) {
    activity.push(line);
  }

  return activity.slice(0, 10);
}

// ── Prompt Builder ──

export function buildEnvPrompt(snapshot?: EnvSnapshot): string {
  const snap = snapshot || _lastSnapshot;
  if (!snap || snap.projects.length === 0) return "";

  const sections: string[] = [];
  sections.push("# Environment Context");
  sections.push(`> Scanned at ${new Date(snap.timestamp).toLocaleString()}`);

  sections.push("\n## System");
  sections.push(`- Platform: ${snap.systemInfo.platform}`);
  if (snap.systemInfo.nodeVersion) sections.push(`- Node: ${snap.systemInfo.nodeVersion}`);
  if (snap.systemInfo.gitVersion) sections.push(`- Git: ${snap.systemInfo.gitVersion}`);

  for (const p of snap.projects) {
    sections.push(`\n## ${p.name} (${p.path})`);
    if (p.techStack.length > 0) sections.push(`- Stack: ${p.techStack.join(", ")}`);
    if (p.packageManager) sections.push(`- Package manager: ${p.packageManager}`);
    if (p.branchName) sections.push(`- Branch: ${p.branchName}`);
    if (p.lastCommit) sections.push(`- Last commit: ${p.lastCommit}`);
    sections.push(`- Files: ~${p.fileCount} | Tests: ${p.hasTests ? "yes" : "no"} | CI: ${p.hasCI ? "yes" : "no"}`);
  }

  if (snap.recentActivity.length > 0) {
    sections.push("\n## Recent Activity");
    for (const a of snap.recentActivity) sections.push(`- ${a}`);
  }

  return sections.join("\n");
}

export function getLastSnapshot(): EnvSnapshot | null {
  return _lastSnapshot;
}

export function clearSnapshot(): void {
  _lastSnapshot = null;
}
