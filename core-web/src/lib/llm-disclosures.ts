export const llmOperationIds = [
  "import_cv",
  "quick_analysis",
  "generate_bundle",
  "reassess_role",
  "generate_gap_tasks",
  "reassess_gap_task",
] as const;

export type LLMOperationId = (typeof llmOperationIds)[number];

export type LLMDisclosureConfig = {
  providerName: string;
  retentionPolicyUrl: string;
};

export type LLMOperationDisclosure = {
  version: string;
  title: string;
  purpose: string;
  dataSent: readonly string[];
  retainedByCVAI: string;
  nonLLMPath: string;
};

const operationDisclosures = {
  import_cv: {
    version: "1",
    title: "Import CV with AI",
    purpose: "extract an editable structured CV from your PDF",
    dataSent: ["the complete selected PDF", "your candidate preferences, when present"],
    retainedByCVAI:
      "CVAI saves the extracted structured CV and validation errors. It does not save the PDF, assembled prompt, or raw provider response.",
    nonLLMPath: "You can cancel and enter or edit your CV manually without using an AI provider.",
  },
  quick_analysis: {
    version: "1",
    title: "Run quick analysis with AI",
    purpose: "estimate your likely fit before you ingest this role",
    dataSent: ["the role text", "the documented quick-analysis projection of your candidate profile"],
    retainedByCVAI:
      "CVAI does not save the analysis preview. Operational rate-limit state may be retained without prompt or response content.",
    nonLLMPath: "You can skip the preview and ingest the role directly.",
  },
  generate_bundle: {
    version: "1",
    title: "Generate role analysis with AI",
    purpose: "extract the job, assess your fit, and create application-supporting artefacts",
    dataSent: [
      "the role source for job extraction",
      "the structured job and documented candidate and evidence projections for assessment",
      "the structured job, completed analysis, and documented public candidate fields for artefacts",
    ],
    retainedByCVAI:
      "CVAI saves the validated Job, Analysis, and approved artefacts. It does not save prompts, raw provider responses, or calibration blocks.",
    nonLLMPath: "You can keep tracking the role without generating a Bundle.",
  },
  reassess_role: {
    version: "1",
    title: "Reassess role with AI",
    purpose: "refresh the role analysis and artefacts after relevant candidate information changes",
    dataSent: [
      "the existing structured Job and Analysis",
      "the documented current candidate and evidence projections",
      "bounded aggregate calibration when eligible",
    ],
    retainedByCVAI:
      "CVAI replaces the validated Analysis and approved artefacts while preserving the Job. It does not save prompts or raw provider responses.",
    nonLLMPath: "You can retain the existing Bundle without reassessing it.",
  },
  generate_gap_tasks: {
    version: "1",
    title: "Generate gap tasks with AI",
    purpose: "turn selected analysis gaps into concrete linked tasks",
    dataSent: ["the selected gaps and requirements", "the minimum documented role context"],
    retainedByCVAI:
      "CVAI saves validated generated tasks and their stable role and gap references. It does not save prompts or raw provider responses.",
    nonLLMPath: "You can cancel and create tasks manually.",
  },
  reassess_gap_task: {
    version: "1",
    title: "Reassess gap with AI",
    purpose: "decide whether one completed task and relevant evidence now satisfy its linked requirement",
    dataSent: [
      "the linked requirement and gap",
      "the completed task result",
      "the documented projection of evidence relevant to that requirement",
    ],
    retainedByCVAI:
      "CVAI saves the justified result and may update only the linked requirement coverage and verdict fields. It does not save prompts or raw provider responses.",
    nonLLMPath: "You can leave the existing gap and analysis unchanged.",
  },
} as const satisfies Record<LLMOperationId, LLMOperationDisclosure>;

export function getLLMOperationDisclosure(operation: LLMOperationId): LLMOperationDisclosure {
  return operationDisclosures[operation];
}

export function validateLLMDisclosureConfig(config: LLMDisclosureConfig): LLMDisclosureConfig {
  const providerName = config.providerName.trim();
  if (!providerName) throw new Error("LLM disclosure providerName is required");

  let retentionPolicyUrl: URL;
  try {
    retentionPolicyUrl = new URL(config.retentionPolicyUrl);
  } catch {
    throw new Error("LLM disclosure retentionPolicyUrl must be an absolute HTTPS URL");
  }
  if (retentionPolicyUrl.protocol !== "https:") {
    throw new Error("LLM disclosure retentionPolicyUrl must be an absolute HTTPS URL");
  }

  return { providerName, retentionPolicyUrl: retentionPolicyUrl.toString() };
}

export type LLMDisclosureAcknowledgement = {
  version: string;
  fingerprint: string;
};

type AcknowledgementStorage = Pick<Storage, "getItem" | "setItem">;

export function getLLMDisclosureAcknowledgement(
  operation: LLMOperationId,
  config: LLMDisclosureConfig,
): LLMDisclosureAcknowledgement {
  const disclosure = getLLMOperationDisclosure(operation);
  const validatedConfig = validateLLMDisclosureConfig(config);
  const material = JSON.stringify({
    operation,
    version: disclosure.version,
    providerName: validatedConfig.providerName,
    retentionPolicyUrl: validatedConfig.retentionPolicyUrl,
    dataSent: disclosure.dataSent,
    retainedByCVAI: disclosure.retainedByCVAI,
    nonLLMPath: disclosure.nonLLMPath,
  });
  return { version: disclosure.version, fingerprint: fnv1a(material) };
}

export function hasLLMDisclosureAcknowledgement(
  operation: LLMOperationId,
  config: LLMDisclosureConfig,
  storage: AcknowledgementStorage,
) {
  const expected = getLLMDisclosureAcknowledgement(operation, config);
  try {
    const stored = storage.getItem(acknowledgementKey(operation));
    if (!stored) return false;
    const parsed = JSON.parse(stored) as Partial<LLMDisclosureAcknowledgement>;
    return parsed.version === expected.version && parsed.fingerprint === expected.fingerprint;
  } catch {
    return false;
  }
}

export function recordLLMDisclosureAcknowledgement(
  operation: LLMOperationId,
  config: LLMDisclosureConfig,
  storage: AcknowledgementStorage,
) {
  const acknowledgement = JSON.stringify(getLLMDisclosureAcknowledgement(operation, config));
  try {
    storage.setItem(acknowledgementKey(operation), acknowledgement);
  } catch {
    // Acknowledgement persistence is best-effort. The active UI session still
    // advances when browser storage is unavailable or over quota.
  }
}

function acknowledgementKey(operation: LLMOperationId) {
  return `cvai.llm-disclosure-ack.${operation}`;
}

function fnv1a(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
