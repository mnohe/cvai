import type { ReactNode } from "react";

export const Slots: {
  AccountPanelExtra: () => ReactNode;
  HeaderRight: () => ReactNode;
  DashboardExtra: () => ReactNode;
  SettingsExtra: () => ReactNode;
} = {
  AccountPanelExtra: () => null,
  HeaderRight: () => null,
  DashboardExtra: () => null,
  SettingsExtra: () => null,
};
