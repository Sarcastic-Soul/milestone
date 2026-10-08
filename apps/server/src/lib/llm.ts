import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { env } from "../env.ts";

const ollama = createOpenAICompatible({
  name: "ollama",
  baseURL: env.OLLAMA_BASE_URL,
  apiKey: env.OLLAMA_API_KEY,
  supportsStructuredOutputs: true,
});

export const model = ollama(env.OLLAMA_MODEL);
