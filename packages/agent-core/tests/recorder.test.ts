import { describe, it, expect } from "vitest";
import { OperationRecorder } from "../src/tools/builtin/recorder.js";

describe("OperationRecorder", () => {
  it("records and saves a trajectory", () => {
    const recorder = new OperationRecorder();
    recorder.startRecording();
    recorder.recordStep({ tool: "browser_open", input: { url: "https://example.com" }, output: "opened", isDynamic: false });
    recorder.recordStep({ tool: "browser_click", input: { selector: "#login" }, output: "clicked", isDynamic: false });
    recorder.recordStep({ tool: "browser_input", input: { selector: "#password", text: "***" }, output: "typed", isDynamic: true, dynamicHint: "Password may change" });

    const trajectory = recorder.stopRecording("Login flow", "Automate login");
    expect(trajectory.steps.length).toBe(3);
    expect(trajectory.name).toBe("Login flow");
    expect(trajectory.steps[2].isDynamic).toBe(true);
  });

  it("replays a trajectory", async () => {
    const recorder = new OperationRecorder();
    recorder.startRecording();
    recorder.recordStep({ tool: "read", input: { path: "test.txt" }, output: "hello", isDynamic: false });
    recorder.recordStep({ tool: "write", input: { path: "out.txt", content: "world" }, output: "ok", isDynamic: false });
    const traj = recorder.stopRecording("Read-write", "Test replay");

    const executor = async (tool: string, input: Record<string, unknown>) => `${tool}:ok`;
    const result = await recorder.replay(traj.id, executor);

    expect(result.success).toBe(true);
    expect(result.stepsExecuted).toBe(2);
    expect(result.outputs.length).toBe(2);
  });

  it("handles replay failures gracefully", async () => {
    const recorder = new OperationRecorder();
    recorder.startRecording();
    recorder.recordStep({ tool: "bash", input: { command: "exit 1" }, output: "", isDynamic: false });
    const traj = recorder.stopRecording("Failing", "Test failure");

    const executor = async () => { throw new Error("Command failed"); };
    const result = await recorder.replay(traj.id, executor);

    expect(result.success).toBe(false);
    expect(result.failedAt).toBe(0);
    expect(result.error).toBe("Command failed");
  });

  it("generates script from trajectory", () => {
    const recorder = new OperationRecorder();
    recorder.startRecording();
    recorder.recordStep({ tool: "browser_open", input: { url: "https://example.com" }, output: "ok", isDynamic: false });
    const traj = recorder.stopRecording("Script test", "Generate script");

    const script = recorder.toScript(traj.id);
    expect(script).toContain("browser_open");
    expect(script).toContain("Script test");
  });

  it("serializes and deserializes", () => {
    const recorder = new OperationRecorder();
    recorder.startRecording();
    recorder.recordStep({ tool: "test", input: {}, output: "ok", isDynamic: false });
    recorder.stopRecording("Serialize", "Test");

    const json = recorder.serialize();
    const recorder2 = new OperationRecorder();
    recorder2.deserialize(json);

    expect(recorder2.listTrajectories().length).toBe(1);
    expect(recorder2.listTrajectories()[0].name).toBe("Serialize");
  });
});
