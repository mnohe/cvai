import { useCallback, useRef, useState } from "react";
import { ActionProgress } from "@/components/ActionProgress";
import { LLMDisclosure } from "@/components/LLMDisclosure";
import { ThinkButton } from "@/components/ThinkButton";
import { apiFetch, getApiErrorMessage } from "@/lib/api";
import { getLLMDisclosureConfig } from "@/lib/config";
import {
  hasLLMDisclosureAcknowledgement,
  recordLLMDisclosureAcknowledgement,
} from "@/lib/llm-disclosures";

const maxPDFBytes = 10 * 1024 * 1024;

export function ImportCVModal({
  onClose,
  onImported,
  replacingExisting = false,
}: {
  onClose: () => void;
  onImported: () => void;
  replacingExisting?: boolean;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [supportReference, setSupportReference] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const disclosureConfig = getLLMDisclosureConfig();
  const [disclosureAcknowledged, setDisclosureAcknowledged] = useState(() =>
    typeof window !== "undefined"
      ? hasLLMDisclosureAcknowledgement("import_cv", disclosureConfig, window.localStorage)
      : false,
  );
  const [disclosureExpanded, setDisclosureExpanded] = useState(!disclosureAcknowledged);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedFileRef = useRef<File | null>(null);

  function prepareUpload() {
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setMessage("Choose a PDF first.");
      return;
    }
    if (file.type !== "application/pdf") {
      setMessage("Choose a PDF file.");
      return;
    }
    if (file.size > maxPDFBytes) {
      setMessage("PDF must be 10 MB or smaller.");
      return;
    }

    setMessage(null);
    selectedFileRef.current = file;
    void upload(file);
  }

  async function upload(file = selectedFileRef.current) {
    if (!file || file.type !== "application/pdf" || file.size > maxPDFBytes) {
      setMessage("Choose a valid PDF file of 10 MB or smaller.");
      return;
    }

    const body = new FormData();
    body.append("pdf", file);

    try {
      setUploading(true);
      setMessage(null);
      setSupportReference(null);
      const response = await apiFetch<{ actionId: string }>("/cv/imports", { method: "POST", body });
      setActionId(response.actionId);
      setMessage("Import started.");
    } catch (error) {
      setMessage(getApiErrorMessage(error, "Import could not be started."));
      setSupportReference(createSupportReference());
    } finally {
      setUploading(false);
    }
  }

  const handleComplete = useCallback(() => {
    setMessage("CV imported.");
    onImported();
    onClose();
  }, [onClose, onImported]);

  const handleFailed = useCallback((reason: string, failedActionId: string) => {
    setMessage(reason);
    setSupportReference(failedActionId);
    setActionId(null);
  }, []);

  async function copySupportReference() {
    if (!supportReference) return;
    await navigator.clipboard?.writeText(supportReference);
  }

  function continueToFileChooser() {
    recordLLMDisclosureAcknowledgement("import_cv", disclosureConfig, window.localStorage);
    setDisclosureAcknowledged(true);
    setDisclosureExpanded(false);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card" role="dialog" aria-modal="true" aria-label="Import CV from PDF">
        <div className="panel-row">
          <div>
            <h2>Import from PDF</h2>
            <p className="muted">Upload a PDF CV.</p>
            {replacingExisting && <p className="form-error">Importing a PDF will replace the current CV.</p>}
          </div>
          <button type="button" className="icon-button" aria-label="Close import modal" onClick={onClose}>
            x
          </button>
        </div>
        <LLMDisclosure
          operation="import_cv"
          config={disclosureConfig}
          expanded={disclosureExpanded}
          onToggle={() => setDisclosureExpanded((current) => !current)}
          continueLabel="Continue to choose PDF"
          onContinue={disclosureAcknowledged ? undefined : continueToFileChooser}
          onCancel={disclosureAcknowledged ? undefined : onClose}
        />
        {disclosureAcknowledged && (
          <>
            <label className="field-label" htmlFor="cv-import-pdf">Choose PDF</label>
            <input id="cv-import-pdf" ref={inputRef} type="file" accept="application/pdf" disabled={Boolean(actionId)} />
            {actionId && <ActionProgress actionId={actionId} onComplete={handleComplete} onFailed={handleFailed} />}
            {message && <p className="muted">{message}</p>}
            {supportReference && (
              <div className="support-reference">
                <span className="muted">Reference ID</span>
                <code>{supportReference}</code>
                <button type="button" className="secondary-button" onClick={() => void copySupportReference()}>
                  Copy
                </button>
              </div>
            )}
            <div className="panel-actions">
              <ThinkButton completionScore={2} onClick={prepareUpload} disabled={uploading || Boolean(actionId)}>
                {uploading ? "Uploading" : "Start import"}
              </ThinkButton>
              <button type="button" className="secondary-button" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function createSupportReference() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `import-start-${crypto.randomUUID()}`;
  }
  return `import-start-${Date.now().toString(36)}`;
}
