import { ContractExtract } from "@milestone/shared";
import { generateText, tool, type ModelMessage, type UserContent } from "ai";
import { extractText, getDocumentProxy } from "unpdf";
import { today } from "./dates.ts";
import { model } from "./llm.ts";

const INSTRUCTIONS = `You read freelance contracts and statements of work.
Pull out the project plan exactly as written. Do not invent phases, payments or people.
- Client payments (deposits, milestone payments) go in "milestones" as a percent of the total fee.
  If the contract gives a fixed amount instead, convert it to a percent of the total.
- Payments the freelancer makes to subcontractors go in "payouts", never in "milestones".
- If no start date is given, use ${today()}.
- If no client email is given, use client@example.com.`;

type ContractInput = { text?: string; file?: { data: Uint8Array; mediaType: string } };

// Returns the contract as plain text when we can read it, so it can be stored with the project.
async function readContractText(input: ContractInput): Promise<string | null> {
  if (input.text?.trim()) return input.text.trim();
  if (input.file?.mediaType === "application/pdf") {
    const pdf = await getDocumentProxy(input.file.data);
    const { text } = await extractText(pdf, { mergePages: true });
    return text.trim() || null;
  }
  return null;
}

export async function extractContract(input: ContractInput): Promise<{ extract: ContractExtract; contractText: string | null }> {
  const contractText = await readContractText(input);

  // Scanned contracts and photos go to the model as images; gemma4 can read them.
  const content: UserContent = contractText
    ? [{ type: "text", text: contractText }]
    : input.file
      ? [
          { type: "text", text: "The contract is in this image." },
          { type: "file", data: input.file.data, mediaType: input.file.mediaType },
        ]
      : [];
  if (content.length === 0) throw new Error("No contract text or readable file given.");

  // Ollama Cloud ignores JSON-schema response formats, so the plan comes back as a tool call:
  // the SDK checks the arguments against the schema. One retry with the error if they don't fit.
  const messages: ModelMessage[] = [{ role: "user", content }];
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await generateText({
      model,
      system: INSTRUCTIONS,
      messages,
      tools: { submit_plan: tool({ description: "Submit the extracted project plan", inputSchema: ContractExtract }) },
      toolChoice: { type: "tool", toolName: "submit_plan" },
      temperature: 0,
    });
    const call = result.toolCalls.find((c) => c.toolName === "submit_plan");
    const parsed = call ? ContractExtract.safeParse(call.input) : null;
    if (parsed?.success) return { extract: parsed.data, contractText };

    const problem = parsed ? parsed.error.message : "You must call submit_plan.";
    messages.push(...result.response.messages, {
      role: "user",
      content: `That plan didn't match the schema: ${problem.slice(0, 1500)}. Call submit_plan again with a fixed plan.`,
    });
  }
  throw new Error("The model couldn't read this contract. Try pasting the text instead.");
}
