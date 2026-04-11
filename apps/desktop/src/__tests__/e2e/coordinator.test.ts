/**
 * Coordinator E2E Tests
 *
 * Tests the intent analysis and task routing logic:
 * - Chat message classification (chat / task / multi_step)
 * - Worker identification from keywords
 * - Multi-step task detection
 * - Edge cases: empty input, mixed intents, long messages
 */
import { describe, it, expect } from "vitest";
import { analyzeIntent } from "../../lib/coordinator";
import type { IntentResult } from "../../lib/coordinator";

describe("Coordinator — Intent Analysis & Routing", () => {
  describe("simple greetings stay as chat type", () => {
    it("classifies '你好' as chat", () => {
      const result = analyzeIntent("你好");
      expect(result.type).toBe("chat");
      expect(result.workers).toHaveLength(0);
    });

    it("classifies 'hello' as chat", () => {
      const result = analyzeIntent("hello");
      expect(result.type).toBe("chat");
      expect(result.workers).toHaveLength(0);
    });

    it("classifies 'hi' as chat", () => {
      const result = analyzeIntent("hi");
      expect(result.type).toBe("chat");
      expect(result.workers).toHaveLength(0);
    });

    it("classifies 'thanks' as chat", () => {
      const result = analyzeIntent("thanks");
      expect(result.type).toBe("chat");
    });

    it("classifies 'bye' as chat", () => {
      const result = analyzeIntent("bye");
      expect(result.type).toBe("chat");
    });

    it("classifies '你是谁' as chat", () => {
      const result = analyzeIntent("你是谁");
      expect(result.type).toBe("chat");
    });

    it("classifies casual Chinese greeting as chat", () => {
      const result = analyzeIntent("嗨，介绍一下");
      expect(result.type).toBe("chat");
      expect(result.workers).toHaveLength(0);
    });
  });

  describe("chat messages route to correct workers", () => {
    // Developer tasks
    it("routes '修复bug' to developer", () => {
      const result = analyzeIntent("帮我修复这个bug");
      expect(result.workers).toContain("developer");
    });

    it("routes 'implement API' to developer", () => {
      const result = analyzeIntent("implement a new REST API endpoint");
      expect(result.workers).toContain("developer");
    });

    it("routes '写一个函数' to developer", () => {
      const result = analyzeIntent("帮我写一个函数来处理文件上传");
      expect(result.workers).toContain("developer");
    });

    it("routes code-related tasks to developer", () => {
      const result = analyzeIntent("重构这个模块的代码");
      expect(result.workers).toContain("developer");
    });

    // Tester tasks
    it("routes '写测试' to tester", () => {
      const result = analyzeIntent("帮我写单测覆盖这个模块");
      expect(result.workers).toContain("tester");
    });

    it("routes 'test' keyword to tester", () => {
      const result = analyzeIntent("write e2e test cases for the login flow");
      expect(result.workers).toContain("tester");
    });

    // DevOps tasks
    it("routes '部署' to devops", () => {
      const result = analyzeIntent("帮我部署到生产环境");
      expect(result.workers).toContain("devops");
    });

    it("routes 'docker' to devops", () => {
      const result = analyzeIntent("create a docker compose configuration");
      expect(result.workers).toContain("devops");
    });

    it("routes 'CI/CD' to devops", () => {
      const result = analyzeIntent("setup github actions ci pipeline");
      expect(result.workers).toContain("devops");
    });

    // Product tasks
    it("routes '需求' to product", () => {
      const result = analyzeIntent("帮我写一个用户需求文档");
      expect(result.workers).toContain("product");
    });

    it("routes 'PRD' to product", () => {
      const result = analyzeIntent("write a prd for the new feature");
      expect(result.workers).toContain("product");
    });

    // Writer tasks
    it("routes '文档' to writer", () => {
      const result = analyzeIntent("帮我写技术文档");
      expect(result.workers).toContain("writer");
    });

    it("routes 'readme' to writer", () => {
      const result = analyzeIntent("update the readme with setup instructions");
      expect(result.workers).toContain("writer");
    });

    // Operations tasks
    it("routes '运营策略' to ops_director", () => {
      const result = analyzeIntent("制定新的运营策略和KPI");
      expect(result.workers).toContain("ops_director");
    });

    // Growth tasks
    it("routes '增长' to growth_hacker", () => {
      const result = analyzeIntent("分析增长漏斗并制定获客方案");
      expect(result.workers).toContain("growth_hacker");
    });

    // Researcher tasks
    it("routes '调研' to researcher", () => {
      const result = analyzeIntent("帮我搜索最新技术动态和竞品分析");
      expect(result.workers).toContain("researcher");
    });

    // Content tasks
    it("routes '文案' to content_ops", () => {
      const result = analyzeIntent("帮我写公众号文案和社媒推文");
      expect(result.workers).toContain("content_ops");
    });

    // Legal tasks
    it("routes '隐私政策' to legal_compliance", () => {
      const result = analyzeIntent("审查隐私协议和GDPR合规");
      expect(result.workers).toContain("legal_compliance");
    });

    // Finance tasks
    it("routes '预算' to financial_analyst", () => {
      const result = analyzeIntent("制定年度预算和ROI分析");
      expect(result.workers).toContain("financial_analyst");
    });

    // Project management tasks
    it("routes '项目排期' to project_manager", () => {
      const result = analyzeIntent("制定项目排期和里程碑计划");
      expect(result.workers).toContain("project_manager");
    });

    // Customer support tasks
    it("routes '客服' to customer_support", () => {
      const result = analyzeIntent("整理客服FAQ和工单处理流程");
      expect(result.workers).toContain("customer_support");
    });

    // Risk analysis tasks
    it("routes '风控' to risk_analyst", () => {
      const result = analyzeIntent("进行风控分析和欺诈检测");
      expect(result.workers).toContain("risk_analyst");
    });
  });

  describe("multi-step tasks identify multiple workers", () => {
    it("detects multi_step when multiple workers match", () => {
      const result = analyzeIntent("先写需求文档，然后实现代码，最后写测试");
      expect(result.type).toBe("multi_step");
      expect(result.workers.length).toBeGreaterThanOrEqual(2);
    });

    it("detects multi_step from explicit multi-step keywords", () => {
      const result = analyzeIntent("从需求到上线的完整项目流程");
      expect(result.type).toBe("multi_step");
    });

    it("detects multi_step for '全流程' keyword", () => {
      const result = analyzeIntent("全流程开发一个新功能");
      expect(result.type).toBe("multi_step");
    });

    it("detects multi_step for '端到端' keyword", () => {
      const result = analyzeIntent("端到端测试和部署");
      expect(result.type).toBe("multi_step");
    });

    it("detects multi_step for '整套' keyword", () => {
      const result = analyzeIntent("做一整套技术方案");
      expect(result.type).toBe("multi_step");
    });

    it("detects multi_step for regex pattern '先.*再.*然后'", () => {
      const result = analyzeIntent("先分析需求再编码然后测试");
      expect(result.type).toBe("multi_step");
    });

    it("includes relevant workers for combined dev+devops task", () => {
      const result = analyzeIntent("开发新功能代码并部署docker到CI/CD");
      expect(result.type).toBe("multi_step");
      expect(result.workers).toEqual(expect.arrayContaining(["developer", "devops"]));
    });

    it("includes product and developer for full project request", () => {
      const result = analyzeIntent("先写PRD需求文档，再实现代码开发");
      expect(result.type).toBe("multi_step");
      expect(result.workers).toEqual(expect.arrayContaining(["product", "developer"]));
    });

    it("sorts workers by relevance score (most matched first)", () => {
      // Developer-heavy message with slight devops mention
      const result = analyzeIntent("实现代码开发编程接口函数优化 然后部署");
      expect(result.type).toBe("multi_step");
      // Developer should have more keyword hits, so should appear first
      expect(result.workers[0]).toBe("developer");
    });
  });

  describe("IntentResult structure", () => {
    it("chat results have empty workers and plan", () => {
      const result = analyzeIntent("你好");
      expect(result.type).toBe("chat");
      expect(result.workers).toEqual([]);
      expect(result.plan).toBeDefined();
      expect(typeof result.plan).toBe("string");
    });

    it("task results have exactly one worker", () => {
      const result = analyzeIntent("帮我修复这个bug");
      if (result.type === "task") {
        expect(result.workers).toHaveLength(1);
      }
    });

    it("multi_step results have multiple workers", () => {
      const result = analyzeIntent("写需求文档并实现代码");
      expect(result.type).toBe("multi_step");
      expect(result.workers.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("edge cases", () => {
    it("handles empty string gracefully", () => {
      const result = analyzeIntent("");
      expect(result).toBeDefined();
      expect(result.type).toBe("chat");
    });

    it("handles very long messages", () => {
      const longMsg = "帮我写代码 ".repeat(100);
      const result = analyzeIntent(longMsg);
      expect(result).toBeDefined();
      expect(result.workers).toContain("developer");
    });

    it("is case-insensitive for English keywords", () => {
      const lower = analyzeIntent("deploy to docker");
      const upper = analyzeIntent("DEPLOY to DOCKER");
      expect(lower.workers).toEqual(upper.workers);
    });

    it("defaults long unrecognized messages to developer task", () => {
      // A long message with no recognized keywords
      const result = analyzeIntent(
        "Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua",
      );
      // Long messages default to developer task
      expect(result.type).toBe("task");
      expect(result.workers).toContain("developer");
    });

    it("short unrecognized messages are classified as chat", () => {
      const result = analyzeIntent("ok");
      expect(result.type).toBe("chat");
    });
  });
});
