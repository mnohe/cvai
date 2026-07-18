import type { ReactNode } from "react";
import { CVPrintPage } from "@/pages/CVPrintPage";
import { LoginPage } from "@/pages/LoginPage";

export interface AppRoute {
  path?: string;
  index?: boolean;
  element: ReactNode;
  shell?: boolean;
}

export const baseRoutes: AppRoute[] = [
  { path: "/login", element: <LoginPage />, shell: false },
  { path: "/profile/cv/print/:template", element: <CVPrintPage />, shell: false },
];

export const extensionRoutes: AppRoute[] = [];

export function resetExtensionRoutes() {
  extensionRoutes.length = 0;
}
