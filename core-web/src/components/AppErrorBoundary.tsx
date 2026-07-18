import { Component, type ErrorInfo, type ReactNode } from "react";
import { CriticalFirebasePage } from "@/components/CriticalFirebasePage";

interface AppErrorBoundaryState {
  error: Error | null;
}

export class AppErrorBoundary extends Component<
  { children: ReactNode },
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { error: null };

  componentDidMount() {
    window.addEventListener("error", this.handleWindowError);
    window.addEventListener("unhandledrejection", this.handleUnhandledRejection);
  }

  componentWillUnmount() {
    window.removeEventListener("error", this.handleWindowError);
    window.removeEventListener("unhandledrejection", this.handleUnhandledRejection);
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("app_runtime_error", error, errorInfo);
  }

  private handleWindowError = (event: ErrorEvent) => {
    this.setState({ error: normaliseError(event.error, event.message) });
  };

  private handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    this.setState({ error: normaliseError(event.reason, "Unhandled promise rejection.") });
  };

  render() {
    if (this.state.error) {
      return (
        <CriticalFirebasePage
          description="The application encountered a runtime error. Reload after checking the local services and browser console."
          detail={this.state.error.message || "The application encountered a runtime error."}
          title="The application cannot continue"
        />
      );
    }

    return this.props.children;
  }
}

function normaliseError(value: unknown, fallback: string) {
  if (value instanceof Error) return value;
  if (typeof value === "string" && value.trim()) return new Error(value);
  return new Error(fallback);
}
