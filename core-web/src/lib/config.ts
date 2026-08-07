import { setApiErrorHandler, type ApiErrorHandler } from "@/lib/api";
import { validateLLMDisclosureConfig, type LLMDisclosureConfig } from "@/lib/llm-disclosures";

let llmDisclosureConfig: LLMDisclosureConfig | null = null;

export function configureCoreWeb(
  options: { apiErrorHandler?: ApiErrorHandler; llmDisclosure?: LLMDisclosureConfig } = {},
) {
  setApiErrorHandler(options.apiErrorHandler);
  llmDisclosureConfig = options.llmDisclosure ? validateLLMDisclosureConfig(options.llmDisclosure) : null;
}

export function getLLMDisclosureConfig(): LLMDisclosureConfig {
  if (!llmDisclosureConfig) {
    throw new Error("LLM disclosure configuration is required before enabling an AI operation");
  }
  return llmDisclosureConfig;
}
