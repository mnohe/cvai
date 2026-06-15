type LogoVariant = "side" | "compact" | "wide";

interface LogoMarkProps {
  mode?: "light" | "dark";
  variant?: LogoVariant;
}

export function LogoMark({
  mode = "light",
  variant = "compact",
}: LogoMarkProps) {
  const cvFill = mode === "dark" ? "white" : "var(--cv-color)";

  if (variant === "side") {
    return (
      <svg
        aria-label="CVAI"
        className="logo-mark logo-mark-side"
        role="img"
        version="1.1"
        viewBox="0 0 77.942 160"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g transform="translate(-167.89 -14.169)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.0337">
          <path d="m185.21 49.169 8e-4 60 51.961-30.001-17.32-9.9998-17.321 10.001-5e-4 -8.66e-4 6.7e-4 -20z" fill={cvFill} />
          <path d="m245.83 114.17-3.8e-4 30-3.9e-4 30-17.32-9.9999 7.2e-4 -20-6.8e-4 -20z" fill="#bfd7ea" />
          <path d="m211.19 34.169-17.32 10.001 51.961 29.999-7.5e-4 -60-17.32 9.9999 7.2e-4 20 5e-4 8.66e-4 -1e-3 -4.01e-4z" fill={cvFill} />
          <path d="m219.85 99.169-51.961 29.999 17.321 10.001 17.32-10.001-7.3e-4 20 17.32 9.9999z" fill="#bfd7ea" />
          <path d="m245.83 84.169-17.32 10v20l17.32-10z" fill="#ff5a5f" />
        </g>
      </svg>
    );
  }

  if (variant === "wide") {
    return (
      <svg
        aria-label="CVAI"
        className="logo-mark logo-mark-wide"
        role="img"
        version="1.1"
        viewBox="0 0 170 121.24"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g transform="translate(-111.19 -70.245)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.0337">
          <path d="m141.18 104.89-29.999 51.962 59.999-9.9e-4 -9.9994-17.32-20.001 1e-3v-1e-3l10-17.32z" fill={cvFill} />
          <path d="m251.19 104.89 29.999 51.962-20 3e-5 -9.9994-17.321-10-17.32z" fill="#bfd7ea" />
          <path d="m221.18 104.89-30 51.961 20.001 1e-3 9.9994-17.321 9.9994 17.321 20-2e-5z" fill="#bfd7ea" />
          <path d="m171.18 104.89-20 1e-3 30 51.961 29.999-51.962h-20l-9.9994 17.321 1e-5 1e-3 -6.2e-4 -8e-4z" fill={cvFill} />
          <path d="m251.18 70.245-10 17.321 10 17.321 10-17.321z" fill="#ff5a5f" />
        </g>
      </svg>
    );
  }

  return (
    <svg
      aria-label="CVAI"
      className="logo-mark logo-mark-compact"
      role="img"
      version="1.1"
      viewBox="0 0 130 103.92"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g transform="translate(-151.19 -52.925)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.0337">
        <path d="m181.18 52.925-29.999 51.962 59.999-9.9e-4 -9.9994-17.32-20.001 1e-3v-1e-3l10-17.32z" fill={cvFill} />
        <path d="m251.19 104.89 29.999 51.962-20 3e-5 -9.9994-17.321-10-17.32z" fill="#bfd7ea" />
        <path d="m221.18 104.89-30 51.961 20.001 1e-3 9.9994-17.321 9.9994 17.321 20-2e-5z" fill="#bfd7ea" />
        <path d="m211.18 52.925-20 1e-3 30 51.961 29.999-51.962h-20l-9.9994 17.321 1e-5 1e-3 -6.2e-4 -8e-4z" fill={cvFill} />
        <path d="m251.18 70.245-10 17.321 10 17.321 10-17.321z" fill="#ff5a5f" />
      </g>
    </svg>
  );
}
