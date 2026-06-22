import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  ATSCVPrintTemplate,
  DefaultCVPrintTemplate,
  printTemplates,
  type CVPrintTemplate,
} from "@/components/CVPrintTemplates";
import type { CV } from "@/lib/types";
import defaultPrintCss from "@/styles/cv-print-default.css?inline";
import atsPrintCss from "@/styles/cv-print-ats.css?inline";

export function CVPrintPreviewDialog({
  cv,
  template,
  onTemplateChange,
  onClose,
}: {
  cv: CV;
  template: CVPrintTemplate;
  onTemplateChange: (template: CVPrintTemplate) => void;
  onClose: () => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    const document = iframe?.contentDocument;
    if (!iframe || !document) return undefined;

    const css = template === "ats" ? atsPrintCss : defaultPrintCss;
    document.open();
    document.write(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>CV print preview</title>
          <style>${css}</style>
        </head>
        <body>
          <main id="cv-print-root" class="cv-print-page cv-print-${template}-page"></main>
        </body>
      </html>
    `);
    document.close();

    const rootElement = document.getElementById("cv-print-root");
    if (!rootElement) return undefined;

    const root = createRoot(rootElement);
    root.render(template === "ats" ? <ATSCVPrintTemplate cv={cv} /> : <DefaultCVPrintTemplate cv={cv} />);

    return () => {
      queueMicrotask(() => root.unmount());
    };
  }, [cv, template]);

  function printPreview() {
    const frameWindow = iframeRef.current?.contentWindow;
    if (!frameWindow) return;
    frameWindow.focus();
    frameWindow.print();
  }

  return (
    <div className="modal-backdrop cv-print-preview-backdrop" role="presentation">
      <section className="cv-print-preview-dialog" role="dialog" aria-modal="true" aria-label="CV print preview">
        <header className="cv-print-preview-toolbar">
          <label className="cv-template-control">
            <span>Template</span>
            <select
              aria-label="Print template"
              value={template}
              onChange={(event) => onTemplateChange(event.target.value as CVPrintTemplate)}
            >
              {printTemplates.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <div className="cv-print-preview-actions">
            <button type="button" className="primary-rect-button" onClick={printPreview}>
              Print
            </button>
            <button type="button" className="secondary-button" onClick={onClose}>
              Close
            </button>
          </div>
        </header>
        <iframe ref={iframeRef} className="cv-print-preview-frame" title="CV print preview" />
      </section>
    </div>
  );
}
