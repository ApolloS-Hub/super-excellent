/**
 * AskUser tool — request input from the user
 * In desktop app, this triggers a UI dialog
 */
import type { ToolDefinitionFull } from "../types.js";

/** Callback for user interaction — set by the frontend */
let userInputCallback: ((question: string) => Promise<string>) | null = null;

export function setUserInputCallback(cb: (question: string) => Promise<string>) {
  userInputCallback = cb;
}

export const askUserTool: ToolDefinitionFull = {
  name: "AskUser",
  description: "Ask the user a question and wait for their response. Use when you need clarification or confirmation.",
  inputSchema: {
    type: "object",
    properties: {
      question: { type: "string", description: "The question to ask the user" },
    },
    required: ["question"],
  },
  isReadOnly: true,
  execute: async (input) => {
    const question = input.question as string;

    if (userInputCallback) {
      return await userInputCallback(question);
    }

    // Fallback: return a message indicating no UI is connected
    return "[AskUser] No UI connected. Question was: " + question;
  },
};
