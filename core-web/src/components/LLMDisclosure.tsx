import { useId } from "react";
import type { LLMDisclosureConfig, LLMOperationId } from "@/lib/llm-disclosures";
import { getLLMOperationDisclosure, validateLLMDisclosureConfig } from "@/lib/llm-disclosures";

export function LLMDisclosure({
  operation,
  config,
  expanded,
  onToggle,
  continueLabel = "Continue",
  onContinue,
  onCancel,
}: {
  operation: LLMOperationId;
  config: LLMDisclosureConfig;
  expanded: boolean;
  onToggle: () => void;
  continueLabel?: string;
  onContinue?: () => void;
  onCancel?: () => void;
}) {
  const disclosure = getLLMOperationDisclosure(operation);
  const validatedConfig = validateLLMDisclosureConfig(config);
  const detailsId = useId();
  const titleId = useId();

  return (
    <section className="llm-disclosure" aria-labelledby={titleId}>
      <button
        type="button"
        className="llm-disclosure-summary"
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={onToggle}
      >
        <span id={titleId}>{disclosure.title}</span>
        <span aria-hidden="true">{expanded ? "−" : "+"}</span>
      </button>
      {expanded && (
        <div id={detailsId} className="llm-disclosure-details">
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
          {onContinue && (
            <div className="panel-actions">
              <button type="button" className="primary-rect-button" onClick={onContinue}>
                {continueLabel}
              </button>
              {onCancel && (
                <button type="button" className="secondary-button" onClick={onCancel}>
                  Cancel
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
