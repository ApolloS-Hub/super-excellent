/**
 * Secretary Agent — Coordinator in the Coordinator-Worker pattern
 * 
 * The Secretary:
 * 1. Understands user intent
 * 2. Determines which workers are needed
 * 3. Creates a task plan
 * 4. Dispatches tasks to workers
 * 5. Collects and merges results
 * 6. Delivers final output to user
 */
import type { Provider, ChatOptions } from "../providers/types.js";
import type { SecretaryConfig, OrchestrationPlan, SubTask, WorkerResult } from "./types.js";
import type { StreamEvent, QueryResult } from "../engine/types.js";
import { WORKER_ROLES, getWorkersByExpertise } from "./workers.js";
import { QueryEngine } from "../engine/query-engine.js";
import { createToolExecutor, BUILTIN_TOOLS } from "../tools/index.js";
import type { ToolDefinitionFull } from "../tools/types.js";

const SECRETARY_SYSTEM_PROMPT = `You are the Secretary Agent — a highly capable AI coordinator.

Your role:
- Understand the user's request deeply
- Decide if you can handle it yourself, or if you need to delegate to specialized workers
- For simple questions/conversations: respond directly
- For complex tasks: create a plan, delegate to workers, and synthesize their outputs

Available Workers:
{{WORKERS}}

When you need to delegate, use the "delegate" tool to assign tasks to workers.
When you can handle it yourself, just respond directly.

Always be helpful, concise, and proactive. You are the user's single point of contact.`;

interface SecretaryOptions {
  provider: Provider;
  config?: Partial<SecretaryConfig>;
  model?: string;
}

export class SecretaryAgent {
  private provider: Provider;
  private config: SecretaryConfig;
  private model: string;

  constructor(options: SecretaryOptions) {
    this.provider = options.provider;
    this.model = options.model ?? "claude-sonnet-4-6";
    this.config = {
      workers: options.config?.workers ?? WORKER_ROLES,
      maxConcurrent: options.config?.maxConcurrent ?? 3,
      autoMerge: options.config?.autoMerge ?? true,
    };
  }

  /**
   * Process a user message through the Secretary
   */
  async *process(userMessage: string): AsyncGenerator<StreamEvent> {
    // Step 1: Analyze intent and decide routing
    const analysis = await this.analyzeIntent(userMessage);

    if (analysis.directResponse) {
      // Simple request — Secretary handles it directly
      yield* this.handleDirectly(userMessage);
      return;
    }

    // Step 2: Create orchestration plan
    yield { type: "thinking", text: `📋 Planning: ${analysis.plan.tasks.length} task(s) for ${[...new Set(analysis.plan.tasks.map(t => t.assignedWorker))].join(", ")}` };

    // Step 3: Execute tasks
    const results: WorkerResult[] = [];

    if (analysis.plan.strategy === "parallel") {
      // Run all tasks in parallel
      const promises = analysis.plan.tasks.map(task => this.executeWorkerTask(task));
      const settled = await Promise.allSettled(promises);

      for (let i = 0; i < settled.length; i++) {
        const result = settled[i];
        const task = analysis.plan.tasks[i];
        if (result.status === "fulfilled") {
          results.push(result.value);
          yield { type: "tool_result", toolResult: { toolCallId: task.id, output: `✅ ${task.assignedWorker}: done`, isError: false } };
        } else {
          results.push({ workerId: task.assignedWorker, taskId: task.id, output: result.reason?.message ?? "Failed", success: false });
          yield { type: "tool_result", toolResult: { toolCallId: task.id, output: `❌ ${task.assignedWorker}: ${result.reason?.message}`, isError: true } };
        }
      }
    } else {
      // Sequential execution
      for (const task of analysis.plan.tasks) {
        yield { type: "thinking", text: `🔧 ${task.assignedWorker}: ${task.description}` };
        try {
          const result = await this.executeWorkerTask(task);
          results.push(result);
          yield { type: "tool_result", toolResult: { toolCallId: task.id, output: `✅ Done`, isError: false } };
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          results.push({ workerId: task.assignedWorker, taskId: task.id, output: errMsg, success: false });
          yield { type: "tool_result", toolResult: { toolCallId: task.id, output: `❌ ${errMsg}`, isError: true } };
        }
      }
    }

    // Step 4: Synthesize results
    const synthesis = await this.synthesizeResults(userMessage, results);
    yield { type: "text", text: synthesis };

    yield {
      type: "result",
      result: {
        text: synthesis,
        messages: [],
        numTurns: analysis.plan.tasks.length + 2,
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        costUsd: 0,
      },
    };
  }

  /**
   * Analyze user intent and create a plan
   */
  private async analyzeIntent(message: string): Promise<{
    directResponse: boolean;
    plan: OrchestrationPlan;
  }> {
    const workerList = this.config.workers
      .map(w => `- ${w.id} (${w.nameZh}/${w.name}): ${w.description}. Expertise: ${w.expertise.join(", ")}`)
      .join("\n");

    const response = await this.provider.chat([
      {
        role: "user",
        content: `Analyze this user request and decide how to handle it.

User request: "${message}"

Available workers:
${workerList}

Respond in JSON format:
{
  "directResponse": true/false,  // true if you can handle it yourself (simple chat, greetings, quick questions)
  "tasks": [  // only if directResponse is false
    {
      "description": "what this task should accomplish",
      "worker": "worker_id",
      "priority": 1
    }
  ],
  "strategy": "sequential" or "parallel"  // parallel if tasks are independent
}

Respond ONLY with the JSON, no other text.`,
      },
    ], {
      model: this.model,
      maxTokens: 1024,
      systemPrompt: "You are a task routing AI. Analyze requests and output JSON only.",
    });

    try {
      // Extract JSON from response (handle markdown code blocks)
      let jsonStr = response.content.trim();
      if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      }
      const parsed = JSON.parse(jsonStr);

      if (parsed.directResponse) {
        return { directResponse: true, plan: { intent: message, tasks: [], strategy: "sequential" } };
      }

      const tasks: SubTask[] = (parsed.tasks || []).map((t: { description: string; worker: string }, i: number) => ({
        id: `task-${i}`,
        description: t.description,
        assignedWorker: t.worker,
        status: "pending" as const,
      }));

      return {
        directResponse: false,
        plan: {
          intent: message,
          tasks,
          strategy: parsed.strategy || "sequential",
        },
      };
    } catch {
      // If JSON parsing fails, handle directly
      return { directResponse: true, plan: { intent: message, tasks: [], strategy: "sequential" } };
    }
  }

  /**
   * Handle a request directly (no delegation)
   */
  private async *handleDirectly(message: string): AsyncGenerator<StreamEvent> {
    const workerInfo = this.config.workers
      .map(w => `${w.nameZh}(${w.name})`)
      .join("、");

    const systemPrompt = SECRETARY_SYSTEM_PROMPT.replace(
      "{{WORKERS}}",
      workerInfo,
    );

    const toolExecutor = createToolExecutor(BUILTIN_TOOLS, "bypassPermissions");
    const engine = new QueryEngine({
      provider: this.provider,
      systemPrompt,
      tools: toolExecutor.getDefinitions(),
      toolExecutor,
      maxTurns: 5,
    });

    yield* engine.execute(message);
  }

  /**
   * Execute a single worker task
   */
  private async executeWorkerTask(task: SubTask): Promise<WorkerResult> {
    const worker = this.config.workers.find(w => w.id === task.assignedWorker);
    if (!worker) {
      return { workerId: task.assignedWorker, taskId: task.id, output: `Unknown worker: ${task.assignedWorker}`, success: false };
    }

    // Create worker-specific tool executor (filtered tools)
    const workerTools = BUILTIN_TOOLS.filter(t => worker.allowedTools.includes(t.name));
    const toolExecutor = createToolExecutor(workerTools, "bypassPermissions");

    const engine = new QueryEngine({
      provider: this.provider,
      systemPrompt: worker.systemPrompt,
      tools: toolExecutor.getDefinitions(),
      toolExecutor,
      maxTurns: 8,
    });

    let output = "";
    for await (const event of engine.execute(task.description)) {
      if (event.type === "text" && event.text) {
        output += event.text;
      }
    }

    return {
      workerId: worker.id,
      taskId: task.id,
      output: output || "(no output)",
      success: true,
    };
  }

  /**
   * Synthesize worker results into a final response
   */
  private async synthesizeResults(originalRequest: string, results: WorkerResult[]): Promise<string> {
    const resultSummary = results
      .map(r => `## ${r.workerId} (${r.success ? "✅" : "❌"})\n${r.output}`)
      .join("\n\n");

    const response = await this.provider.chat([
      {
        role: "user",
        content: `The user asked: "${originalRequest}"

Workers completed their tasks. Here are the results:

${resultSummary}

Please synthesize these results into a clear, cohesive response for the user. 
- Combine insights from all workers
- Highlight key points
- If any worker failed, note what wasn't completed
- Be concise but thorough`,
      },
    ], {
      model: this.model,
      maxTokens: 4096,
      systemPrompt: "You are synthesizing multiple AI workers' outputs into one coherent response. Be clear and well-structured.",
    });

    return response.content;
  }
}
