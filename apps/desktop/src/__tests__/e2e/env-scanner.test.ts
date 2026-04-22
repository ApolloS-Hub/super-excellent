/**
 * Environment Scanner tests — build mode prompt building
 */
import { describe, it, expect } from "vitest";
import { buildEnvPrompt, clearSnapshot, getLastSnapshot } from "../../lib/env-scanner";

describe("env-scanner: buildEnvPrompt", () => {
  it("returns empty string when no snapshot exists", () => {
    clearSnapshot();
    expect(buildEnvPrompt()).toBe("");
  });

  it("returns empty string when snapshot has no projects", () => {
    expect(buildEnvPrompt({
      timestamp: Date.now(),
      projects: [],
      systemInfo: { platform: "linux", shell: "bash" },
      recentActivity: [],
    })).toBe("");
  });

  it("renders a structured markdown prompt for a populated snapshot", () => {
    const prompt = buildEnvPrompt({
      timestamp: Date.now(),
      projects: [
        {
          path: "/home/user/myapp",
          name: "myapp",
          techStack: ["Node.js", "TypeScript", "React"],
          packageManager: "pnpm",
          lastCommit: "abc123 fix: layout bug",
          branchName: "main",
          fileCount: 450,
          hasTests: true,
          hasCI: true,
          mainLanguage: "TypeScript",
        },
      ],
      systemInfo: { platform: "Darwin", shell: "zsh", nodeVersion: "v20.11.0", gitVersion: "2.44.0" },
      recentActivity: ["[myapp] abc123 fix: layout bug"],
    });
    expect(prompt).toContain("# Environment Context");
    expect(prompt).toContain("## System");
    expect(prompt).toContain("Darwin");
    expect(prompt).toContain("## myapp");
    expect(prompt).toContain("Stack: Node.js, TypeScript, React");
    expect(prompt).toContain("pnpm");
    expect(prompt).toContain("main");
    expect(prompt).toContain("abc123");
    expect(prompt).toContain("Tests: yes");
    expect(prompt).toContain("CI: yes");
    expect(prompt).toContain("## Recent Activity");
  });

  it("reports 'no' for tests/CI when not present", () => {
    const prompt = buildEnvPrompt({
      timestamp: Date.now(),
      projects: [
        {
          path: "/x",
          name: "nada",
          techStack: [],
          fileCount: 5,
          hasTests: false,
          hasCI: false,
        },
      ],
      systemInfo: { platform: "linux", shell: "sh" },
      recentActivity: [],
    });
    expect(prompt).toContain("Tests: no");
    expect(prompt).toContain("CI: no");
  });
});

describe("env-scanner: getLastSnapshot / clearSnapshot", () => {
  it("getLastSnapshot returns null initially", () => {
    clearSnapshot();
    expect(getLastSnapshot()).toBeNull();
  });
});
