import {
  AppShell,
  PlaceholderPage,
  ProfilePage,
  SettingsPage,
  baseRoutes,
  extensionRoutes,
  resetExtensionRoutes,
  type AppRoute,
} from "@cvai/core-web";

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
