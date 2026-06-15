import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ThinkButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  completionScore?: number;
  unavailable?: boolean;
  variant?: "primary" | "ghost";
}

export function ThinkButton({
  children,
  completionScore = 0,
  unavailable = false,
  variant = "primary",
  disabled,
  ...props
}: ThinkButtonProps) {
  const locked = completionScore < 2;
  const isDisabled = disabled || locked || unavailable;
  const title = locked
    ? "Complete your profile first (2 of 5 required)"
    : unavailable
      ? "Not available yet"
      : props.title;

  return (
    <button
      {...props}
      className={`btn-hex ${variant === "primary" ? "btn-primary" : "btn-ghost"} ${props.className ?? ""}`}
      disabled={isDisabled}
      title={title}
      type={props.type ?? "button"}
    >
      {children}
    </button>
  );
}
