import type { ReactNode } from "react";

export const Slots: {
  AccountPanelExtra: () => ReactNode;
  HeaderRight: () => ReactNode;
  DashboardExtra: () => ReactNode;
  SettingsExtra: () => ReactNode;
  PrivacySettings: () => ReactNode;
} = {
  AccountPanelExtra: () => null,
  HeaderRight: () => null,
  DashboardExtra: () => null,
  SettingsExtra: () => null,
  PrivacySettings: () => (
    <section className="settings-section">
      <h2>Privacy</h2>
      <p className="muted">Account privacy controls are provided by the hosted service.</p>
    </section>
  ),
};
