/**
 * Operation Recorder — Record-once, replay-forever pattern
 * Inspired by ZeroToken: record browser/tool operations, replay without LLM cost
 * 
 * Key concept: Agent does a task once with full LLM reasoning,
 * the trajectory is recorded, then replayed deterministically
 * without consuming tokens.
 */

export interface RecordedStep {
  index: number;
  tool: string;
  input: Record<string, unknown>;
  output: string;
  timestamp: number;
  screenshot?: string;
  /** Steps that need human/AI judgment on replay */
  isDynamic: boolean;
  dynamicHint?: string;
}

export interface Trajectory {
  id: string;
  name: string;
  description: string;
  steps: RecordedStep[];
  variables: Record<string, string>;
  createdAt: number;
  lastReplayedAt?: number;
  replayCount: number;
  successRate: number;
}

export interface ReplayResult {
  success: boolean;
  stepsExecuted: number;
  stepsTotal: number;
  failedAt?: number;
  error?: string;
  outputs: string[];
  duration: number;
}

export class OperationRecorder {
  private recording: boolean = false;
  private currentTrajectory: RecordedStep[] = [];
  private trajectories: Map<string, Trajectory> = new Map();

  /** Start recording a new trajectory */
  startRecording(): void {
    this.recording = true;
    this.currentTrajectory = [];
  }

  /** Record a single step */
  recordStep(step: Omit<RecordedStep, "index" | "timestamp">): void {
    if (!this.recording) return;

    this.currentTrajectory.push({
      ...step,
      index: this.currentTrajectory.length,
      timestamp: Date.now(),
    });
  }

  /** Stop recording and save trajectory */
  stopRecording(name: string, description: string): Trajectory {
    this.recording = false;

    const trajectory: Trajectory = {
      id: `traj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      description,
      steps: [...this.currentTrajectory],
      variables: this.extractVariables(this.currentTrajectory),
      createdAt: Date.now(),
      replayCount: 0,
      successRate: 1,
    };

    this.trajectories.set(trajectory.id, trajectory);
    this.currentTrajectory = [];
    return trajectory;
  }

  /** Replay a trajectory deterministically */
  async replay(
    trajectoryId: string,
    executor: (tool: string, input: Record<string, unknown>) => Promise<string>,
    variables?: Record<string, string>,
  ): Promise<ReplayResult> {
    const trajectory = this.trajectories.get(trajectoryId);
    if (!trajectory) throw new Error(`Trajectory ${trajectoryId} not found`);

    const startTime = Date.now();
    const outputs: string[] = [];
    let stepsExecuted = 0;

    for (const step of trajectory.steps) {
      try {
        // Substitute variables in input
        let input = step.input;
        if (variables) {
          input = JSON.parse(
            JSON.stringify(input).replace(
              /\{\{(\w+)\}\}/g,
              (_, key) => variables[key] ?? `{{${key}}}`,
            ),
          );
        }

        if (step.isDynamic) {
          // Dynamic steps need special handling — skip or use hint
          outputs.push(`[DYNAMIC] ${step.dynamicHint ?? "Requires judgment"}`);
        } else {
          const output = await executor(step.tool, input);
          outputs.push(output);
        }

        stepsExecuted++;
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        trajectory.successRate = trajectory.replayCount > 0
          ? (trajectory.successRate * trajectory.replayCount + 0) / (trajectory.replayCount + 1)
          : 0;
        trajectory.replayCount++;

        return {
          success: false,
          stepsExecuted,
          stepsTotal: trajectory.steps.length,
          failedAt: step.index,
          error: errMsg,
          outputs,
          duration: Date.now() - startTime,
        };
      }
    }

    trajectory.successRate = trajectory.replayCount > 0
      ? (trajectory.successRate * trajectory.replayCount + 1) / (trajectory.replayCount + 1)
      : 1;
    trajectory.replayCount++;
    trajectory.lastReplayedAt = Date.now();

    return {
      success: true,
      stepsExecuted,
      stepsTotal: trajectory.steps.length,
      outputs,
      duration: Date.now() - startTime,
    };
  }

  /** List all saved trajectories */
  listTrajectories(): Trajectory[] {
    return Array.from(this.trajectories.values())
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Delete a trajectory */
  deleteTrajectory(id: string): boolean {
    return this.trajectories.delete(id);
  }

  /** Convert trajectory to script (for scheduled execution) */
  toScript(trajectoryId: string): string {
    const trajectory = this.trajectories.get(trajectoryId);
    if (!trajectory) throw new Error(`Trajectory ${trajectoryId} not found`);

    const lines = [
      `// Auto-generated script: ${trajectory.name}`,
      `// ${trajectory.description}`,
      `// Steps: ${trajectory.steps.length}`,
      `// Success rate: ${(trajectory.successRate * 100).toFixed(0)}%`,
      "",
      "const steps = [",
    ];

    for (const step of trajectory.steps) {
      if (step.isDynamic) {
        lines.push(`  // DYNAMIC: ${step.dynamicHint ?? "Needs judgment"}`);
      }
      lines.push(`  { tool: "${step.tool}", input: ${JSON.stringify(step.input)} },`);
    }

    lines.push("];");
    return lines.join("\n");
  }

  /** Extract common variable patterns from steps */
  private extractVariables(steps: RecordedStep[]): Record<string, string> {
    const vars: Record<string, string> = {};
    // Look for URL patterns, file paths, selectors that might change
    for (const step of steps) {
      const inputStr = JSON.stringify(step.input);
      // URL variables
      const urls = inputStr.match(/https?:\/\/[^\s"]+/g);
      if (urls) {
        urls.forEach((url, i) => {
          vars[`url_${i}`] = url;
        });
      }
    }
    return vars;
  }

  /** Serialize all trajectories */
  serialize(): string {
    return JSON.stringify(Array.from(this.trajectories.entries()));
  }

  /** Deserialize trajectories */
  deserialize(json: string): void {
    const entries = JSON.parse(json) as Array<[string, Trajectory]>;
    this.trajectories = new Map(entries);
  }
}
