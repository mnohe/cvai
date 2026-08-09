export { AppShell } from "@/app/AppShell";
export { configureCoreWeb } from "@/lib/config";
export {
  ApiError,
  apiFetch,
  getApiErrorMessage,
  type ApiErrorHandler,
  type ApiFailureReason,
} from "@/lib/api";
export { Slots } from "@/slots";
export { baseRoutes, extensionRoutes, resetExtensionRoutes, type AppRoute } from "@/routing/routes";

export { ActionProgress } from "@/components/ActionProgress";
export { AccountPanelProvider, useAccountPanel } from "@/components/AccountPanelContext";
export { AppErrorBoundary } from "@/components/AppErrorBoundary";
export { AuthProvider, useAuth } from "@/components/AuthProvider";
export { CriticalFirebasePage } from "@/components/CriticalFirebasePage";
export { CVPrintPreviewDialog } from "@/components/CVPrintPreviewDialog";
export { ImportCVModal } from "@/components/ImportCVModal";
export { LLMDisclosure } from "@/components/LLMDisclosure";
export { LogoMark } from "@/components/LogoMark";
export { ProfileCompletionMeter } from "@/components/ProfileCompletionMeter";
export { ProtectedRoute } from "@/components/ProtectedRoute";
export { Shell } from "@/components/Shell";
export { RuntimeStatusProvider, useRuntimeStatus } from "@/components/RuntimeStatusProvider";
export { ThinkButton } from "@/components/ThinkButton";

export { CVPrintPage } from "@/pages/CVPrintPage";
export { LoginPage } from "@/pages/LoginPage";
export { PlaceholderPage } from "@/pages/PlaceholderPage";
export { ProfilePage } from "@/pages/ProfilePage";
export { SettingsPage } from "@/pages/SettingsPage";

export { app, auth, db, githubProvider, googleProvider } from "@/lib/firebase";

export {
  getLLMDisclosureAcknowledgement,
  getLLMOperationDisclosure,
  hasLLMDisclosureAcknowledgement,
  llmOperationIds,
  recordLLMDisclosureAcknowledgement,
  validateLLMDisclosureConfig,
  type LLMDisclosureAcknowledgement,
  type LLMDisclosureConfig,
  type LLMOperationDisclosure,
  type LLMOperationId,
} from "@/lib/llm-disclosures";

export type * from "@/lib/types";
