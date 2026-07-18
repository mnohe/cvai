import { logoImageSources, logoImageSrc, productName } from "@branding";

type LogoVariant = "side" | "compact" | "wide";
type LogoMode = "light" | "dark";
type LogoImageSources = Partial<Record<LogoVariant, Partial<Record<LogoMode, string>> & { default?: string }>>;

interface LogoMarkProps {
  mode?: LogoMode;
  variant?: LogoVariant;
}

export function LogoMark({
  mode = "light",
  variant = "compact",
}: LogoMarkProps) {
  const src = resolveLogoSrc(variant, mode);

  return (
    <img
      alt={productName}
      className={`logo-mark logo-mark-${variant}`}
      src={src}
    />
  );
}

function resolveLogoSrc(variant: LogoVariant, mode: LogoMode) {
  const sources = logoImageSources as LogoImageSources | undefined;
  const variantSources = sources?.[variant];
  if (variantSources?.[mode]) {
    return variantSources[mode];
  }
  if (variantSources?.default) {
    return variantSources.default;
  }
  return logoImageSrc;
}
