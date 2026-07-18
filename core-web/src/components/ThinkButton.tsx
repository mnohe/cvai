import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useAccountPanel } from "@/components/AccountPanelContext";
import { useRuntimeStatus } from "@/components/RuntimeStatusProvider";

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
  const { openAccountPanel } = useAccountPanel();
  const { backendIssueActive } = useRuntimeStatus();
  const locked = completionScore < 2;
  const isDisabled = disabled || locked || unavailable;
  const title = locked
    ? "Complete your profile first (2 of 5 required)"
    : backendIssueActive
      ? "Open status"
      : unavailable
      ? "Not available yet"
      : props.title;

  return (
    <button
      {...props}
      className={`think-button ${variant === "primary" ? "think-button-primary" : "think-button-ghost"} ${props.className ?? ""}`}
      disabled={isDisabled}
      onClick={(event) => {
        if (backendIssueActive) {
          event.preventDefault();
          openAccountPanel({ flashStatus: true });
          return;
        }
        props.onClick?.(event);
      }}
      title={title}
      type={props.type ?? "button"}
    >
      <span className="think-button-label">{children}</span>
      <span className="think-button-marker" aria-hidden="true" />
    </button>
  );
}
