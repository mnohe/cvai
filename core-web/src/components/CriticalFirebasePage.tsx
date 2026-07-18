import { productName } from "@branding";
import { LogoMark } from "@/components/LogoMark";

export function CriticalFirebasePage({
  description = "The Firebase backend is required before the application can start. Check that Auth and Firestore are available, then reload this page.",
  detail,
  title = `${productName} cannot connect to Firebase`,
}: {
  description?: string;
  detail?: string;
  title?: string;
}) {
  return (
    <main className="critical-page" role="alert">
      <section className="critical-panel">
        <LogoMark variant="wide" />
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
          {detail && <p className="critical-detail">{detail}</p>}
        </div>
        <button
          type="button"
          className="primary-rect-button"
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </section>
    </main>
  );
}
