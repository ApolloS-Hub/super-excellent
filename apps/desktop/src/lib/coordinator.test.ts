import { describe, expect, it } from "vitest";
import { analyzeIntent } from "./coordinator";

describe("analyzeIntent", () => {
  it("routes coding tasks to developer", () => {
    const result = analyzeIntent("帮我修复这个 TypeScript API bug，并重构一下模块");
    expect(result.type).toBe("task");
    expect(result.workers).toContain("developer");
  });

  it("routes support questions to customer support", () => {
    const result = analyzeIntent("请帮我整理客服 FAQ、工单 SLA 和投诉处理流程");
    expect(result.type).toBe("task");
    expect(result.workers).toContain("customer_support");
  });

  it("routes compliance-heavy requests through legal first", () => {
    const result = analyzeIntent("帮我审查隐私政策、服务条款和 GDPR 合规风险");
    expect(result.type).toBe("multi_step");
    expect(result.workers[0]).toBe("legal_compliance");
    expect(result.workers).toContain("project_manager");
  });

  it("detects multi-step tasks across multiple workers", () => {
    const result = analyzeIntent("从需求到上线做完整项目，先写 PRD 再开发然后部署到 CI/CD");
    expect(result.type).toBe("multi_step");
    expect(result.workers).toEqual(expect.arrayContaining(["product", "developer", "devops"]));
  });

  it("falls back to chat for casual greetings", () => {
    const result = analyzeIntent("你好，介绍一下你是谁");
    expect(result.type).toBe("chat");
    expect(result.workers).toHaveLength(0);
  });
});
