import { createRequire } from "node:module";
import { jsonSchema, tool, type ToolSet } from "ai";
import { env } from "../env.ts";

// @paypal/agent-toolkit ships an AI SDK v4 adapter, but we're on v7. Its OpenAI adapter is
// framework-free (plain JSON schemas plus a call handler), so we wrap that instead.
const require = createRequire(import.meta.url);
const { PayPalAgentToolkit } = require("@paypal/agent-toolkit/openai") as typeof import("@paypal/agent-toolkit/openai");

// Read-only on purpose: the agent looks things up, and every change goes through an approval.
const toolkit = new PayPalAgentToolkit({
  clientId: env.PAYPAL_CLIENT_ID,
  clientSecret: env.PAYPAL_SECRET,
  configuration: {
    actions: { invoices: { get: true }, disputes: { get: true } },
    context: { sandbox: env.PAYPAL_ENVIRONMENT === "SANDBOX" },
  },
});

let callCount = 0;

export function paypalReadTools(): ToolSet {
  const tools: ToolSet = {};
  for (const t of toolkit.getTools()) {
    if (t.type !== "function") continue;
    const { name, description, parameters } = t.function;
    tools[name] = tool({
      description: description ?? name,
      inputSchema: jsonSchema(parameters as Parameters<typeof jsonSchema>[0]),
      execute: async (input) => {
        const reply = await toolkit.handleToolCall({
          id: `call_${++callCount}`,
          type: "function",
          function: { name, arguments: JSON.stringify(input) },
        });
        // Invoices are long; the model only needs the first part to judge the situation.
        return String(reply.content).slice(0, 4000);
      },
    });
  }
  return tools;
}
