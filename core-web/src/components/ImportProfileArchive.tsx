import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { apiFetch, getApiErrorMessage } from "@/lib/api";

const maxArchiveBytes = 20 * 1024 * 1024;

type ImportResult = {
  imported: string[];
  absent: string[];
  unsupportedEntries: number;
  unsupportedFields: number;
};

export function ImportProfileArchive({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const archiveRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [secret, setSecret] = useState("");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    headingRef.current?.focus();
    return () => openerRef.current?.focus();
  }, []);

  function handleDialogKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), summary, [href], [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter((element) => !element.hasAttribute("hidden"));
    if (focusable.length === 0) {
      event.preventDefault();
      headingRef.current?.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function submit() {
    const archive = archiveRef.current?.files?.[0];
    if (!archive || archive.size === 0 || archive.size > maxArchiveBytes || !secret.trim()) {
      setMessage("Choose an encrypted archive of 20 MB or less and enter its decryption secret.");
      return;
    }
    const body = new FormData();
    body.append("archive", archive);
    body.append("secret", secret.trim());
    try {
      setWorking(true);
      setMessage(null);
      const imported = await apiFetch<ImportResult>("/profile/imports", {
        method: "POST",
        body,
        timeoutMs: 30_000,
      });
      setSecret("");
      if (archiveRef.current) archiveRef.current.value = "";
      setResult(imported);
    } catch (error) {
      setMessage(getApiErrorMessage(error, "The encrypted profile archive could not be imported."));
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-import-heading"
        onKeyDown={handleDialogKeyDown}
      >
        <div className="panel-row">
          <div>
            <h2 id="profile-import-heading" ref={headingRef} tabIndex={-1}>Import encrypted profile archive</h2>
            <p className="muted">
              Imports only profile data into an empty profile. It does not restore account, billing, actions,
              applications, tasks, or other workspace data.
            </p>
          </div>
          <button type="button" className="icon-button" aria-label="Close profile import" onClick={onClose}>x</button>
        </div>
        {!result ? (
          <>
            <label className="field-label" htmlFor="profile-import-archive">Encrypted archive</label>
            <input id="profile-import-archive" ref={archiveRef} type="file" accept=".age,application/octet-stream" />
            <label className="field-label" htmlFor="profile-import-secret">Decryption secret</label>
            <input
              id="profile-import-secret"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={secret}
              onChange={(event) => setSecret(event.currentTarget.value)}
            />
            <p className="muted">The archive and secret are used for this import only and are not saved by the browser.</p>
            {message && <p className="form-error" role="alert">{message}</p>}
            <div className="panel-actions">
              <button type="button" className="primary-rect-button" disabled={working} onClick={() => void submit()}>
                {working ? "Importing..." : "Import profile"}
              </button>
              <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>
            </div>
          </>
        ) : (
          <div role="status" className="privacy-result">
            <h3>Profile imported</h3>
            <p>Imported: {result.imported.join(", ")}.</p>
            <p>{result.absent.length > 0 ? `Absent: ${result.absent.join(", ")}.` : "No eligible profile sections were absent."}</p>
            <p>
              Ignored as unsupported: {result.unsupportedEntries} archive entries and {result.unsupportedFields} profile fields.
            </p>
            <p className="muted">This was a best-effort profile import, not a backup or full account restoration.</p>
            <button type="button" className="primary-rect-button" onClick={onImported}>View imported profile</button>
          </div>
        )}
      </section>
    </div>
  );
}
