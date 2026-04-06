import { describe, expect, it } from "vitest";
import {
  WORKFLOW_TEMPLATES,
  getAllTemplates,
  getTemplateForRole,
} from "../src/orchestrator/workflow-templates.js";
import { getAllRoles } from "../src/orchestrator/roles.js";

describe("Workflow Templates", () => {
  it("covers all 8 business/operations roles", () => {
    expect(WORKFLOW_TEMPLATES).toHaveLength(8);
    const ids = WORKFLOW_TEMPLATES.map((t) => t.roleId);
    expect(ids).toEqual(
      expect.arrayContaining([
        "operations-director",
        "growth-hacker",
        "content-operations",
        "legal-compliance",
        "finance-analyst",
        "project-manager",
        "customer-support",
        "risk-analyst",
      ]),
    );
  });

  it("each template has at least 4 steps", () => {
    for (const template of WORKFLOW_TEMPLATES) {
      expect(template.steps.length).toBeGreaterThanOrEqual(4);
    }
  });

  it("every step has id, label, description", () => {
    for (const template of WORKFLOW_TEMPLATES) {
      for (const step of template.steps) {
        expect(step.id).toBeTruthy();
        expect(step.label).toBeTruthy();
        expect(step.description).toBeTruthy();
      }
    }
  });

  it("at least one step per template produces an outputArtifact", () => {
    for (const template of WORKFLOW_TEMPLATES) {
      const hasArtifact = template.steps.some((step) => step.outputArtifact);
      expect(hasArtifact).toBe(true);
    }
  });

  it("getTemplateForRole returns correct template", () => {
    const template = getTemplateForRole("growth-hacker");
    expect(template).toBeDefined();
    expect(template!.name).toBe("增长实验");
  });

  it("getTemplateForRole returns undefined for engineering roles", () => {
    expect(getTemplateForRole("developer")).toBeUndefined();
  });

  it("all template roleIds exist in the canonical role registry", () => {
    const canonicalIds = getAllRoles().map((role) => role.id);
    for (const template of getAllTemplates()) {
      expect(canonicalIds).toContain(template.roleId);
    }
  });
});
