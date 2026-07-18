import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Shell } from "@/components/Shell";
import type { AppRoute } from "@/routing/routes";

export function AppShell({ routes }: { routes: AppRoute[] }) {
  const publicRoutes = routes.filter((route) => route.shell === false);
  const shellRoutes = routes.filter((route) => route.shell !== false);

  return (
    <Routes>
      {publicRoutes.map((route) => (
        <Route
          key={route.path ?? "public-index"}
          path={route.path}
          index={route.index}
          element={route.element}
        />
      ))}
      <Route element={<ProtectedRoute />}>
        <Route element={<Shell />}>
          {shellRoutes.map((route) => (
            <Route
              key={route.path ?? "shell-index"}
              path={route.path}
              index={route.index}
              element={route.element}
            />
          ))}
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
