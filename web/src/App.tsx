import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Shell } from "@/components/Shell";
import { LoginPage } from "@/pages/LoginPage";
import { PlaceholderPage } from "@/pages/PlaceholderPage";
import { ProfilePage } from "@/pages/ProfilePage";
import { SettingsPage } from "@/pages/SettingsPage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<Shell />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<PlaceholderPage name="dashboard" />} />
          <Route path="/roles" element={<PlaceholderPage name="roles" />} />
          <Route path="/profile" element={<Navigate to="/profile/cv" replace />} />
          <Route path="/profile/:section" element={<ProfilePage />} />
          <Route path="/cv" element={<Navigate to="/profile/cv" replace />} />
          <Route path="/tasks" element={<PlaceholderPage name="tasks" />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/account" element={<Navigate to="/settings" replace />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
