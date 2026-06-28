import { useCallback, useRef, useState } from "react";
import { ActionProgress } from "@/components/ActionProgress";
import { ThinkButton } from "@/components/ThinkButton";
import { ApiError, apiFetch } from "@/lib/api";

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
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload() {
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
      if (error instanceof ApiError && error.status === 402) {
        setMessage("This action is not available.");
      } else {
        setMessage("Import could not be started.");
      }
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
        <input ref={inputRef} type="file" accept="application/pdf" disabled={Boolean(actionId)} />
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
          <ThinkButton completionScore={2} onClick={() => void upload()} disabled={uploading || Boolean(actionId)}>
            {uploading ? "Uploading" : "Start import"}
          </ThinkButton>
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}
