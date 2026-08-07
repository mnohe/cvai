import {
  AppShell,
  PlaceholderPage,
  ProfilePage,
  SettingsPage,
  baseRoutes,
  configureCoreWeb,
  extensionRoutes,
  resetExtensionRoutes,
  type AppRoute,
} from "@cvai/core-web";

configureCoreWeb({
  llmDisclosure: {
    providerName: import.meta.env.VITE_LLM_PROVIDER_NAME,
    retentionPolicyUrl: import.meta.env.VITE_LLM_RETENTION_POLICY_URL,
  },
});

const ossRoutes: AppRoute[] = [
  { index: true, element: <PlaceholderPage name="dashboard" /> },
  { path: "/dashboard", element: <PlaceholderPage name="dashboard" /> },
  { path: "/roles", element: <PlaceholderPage name="roles" /> },
  { path: "/profile", element: <ProfilePage /> },
  { path: "/profile/:section", element: <ProfilePage /> },
  { path: "/tasks", element: <PlaceholderPage name="tasks" /> },
  { path: "/settings", element: <SettingsPage /> },
  { path: "/account", element: <SettingsPage /> },
];

resetExtensionRoutes();
extensionRoutes.push(...ossRoutes);

export default function App() {
  return <AppShell routes={[...baseRoutes, ...extensionRoutes]} />;
}
