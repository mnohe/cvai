import { useMemo } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import {
  ATSCVPrintTemplate,
  DefaultCVPrintTemplate,
  type CVPrintTemplate,
} from "@/components/CVPrintTemplates";
import type { CV } from "@/lib/types";
import "@/styles/cv-print-default.css";
import "@/styles/cv-print-ats.css";

const printCVSessionKey = "cvai:print-cv";

export function CVPrintPage() {
  const { template = "default" } = useParams();
  const location = useLocation();
  const cv = useMemo(() => readPrintCV(location.state), [location.state]);

  if (!isPrintTemplate(template)) {
    return <Navigate to="/profile/cv/print/default" replace state={location.state} />;
  }

  if (!cv) {
    return (
      <main className="cv-print-missing">
        <p>Open print preview from your CV page first.</p>
        <Link to="/profile/cv">Back to CV</Link>
      </main>
    );
  }

  return (
    <main className={`cv-print-page cv-print-${template}-page`}>
      <nav className="cv-print-actions" aria-label="Print actions">
        <Link to="/profile/cv" className="secondary-button">
          Back
        </Link>
        <button type="button" className="primary-rect-button" onClick={() => window.print()}>
          Print
        </button>
      </nav>
      {template === "ats" ? <ATSCVPrintTemplate cv={cv} /> : <DefaultCVPrintTemplate cv={cv} />}
    </main>
  );
}

export function writePrintCV(cv: CV) {
  sessionStorage.setItem(printCVSessionKey, JSON.stringify(cv));
}

function readPrintCV(state: unknown): CV | null {
  if (isPrintState(state)) return state.cv;

  const stored = sessionStorage.getItem(printCVSessionKey);
  if (!stored) return null;

  try {
    return JSON.parse(stored) as CV;
  } catch {
    return null;
  }
}

function isPrintState(state: unknown): state is { cv: CV } {
  return typeof state === "object" && state !== null && "cv" in state;
}

function isPrintTemplate(value: string): value is CVPrintTemplate {
  return value === "default" || value === "ats";
}
