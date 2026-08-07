import type { LLMDisclosureConfig, LLMOperationId } from "@/lib/llm-disclosures";
import { getLLMOperationDisclosure, validateLLMDisclosureConfig } from "@/lib/llm-disclosures";

export function LLMDisclosure({
  operation,
  config,
  confirmLabel = "Continue with AI",
  onConfirm,
  onCancel,
}: {
  operation: LLMOperationId;
  config: LLMDisclosureConfig;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const disclosure = getLLMOperationDisclosure(operation);
  const validatedConfig = validateLLMDisclosureConfig(config);

  return (
    <section className="llm-disclosure" role="alertdialog" aria-modal="true" aria-labelledby="llm-disclosure-title">
      <h3 id="llm-disclosure-title">{disclosure.title}</h3>
      <p>
        To {disclosure.purpose}, CVAI will send the following to <strong>{validatedConfig.providerName}</strong>:
      </p>
      <ul>
        {disclosure.dataSent.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p>{disclosure.retainedByCVAI}</p>
      <p>
        The provider may process or retain submitted data under its terms. Read the{" "}
        <a href={validatedConfig.retentionPolicyUrl} target="_blank" rel="noreferrer">
          provider processing and retention information
        </a>
        .
      </p>
      <p>{disclosure.nonLLMPath}</p>
      <p className="form-error">
        Do not submit unnecessary third-party, confidential, or special-category information.
      </p>
      <div className="panel-actions">
        <button type="button" className="primary-rect-button" onClick={onConfirm}>
          {confirmLabel}
        </button>
        <button type="button" className="secondary-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}
