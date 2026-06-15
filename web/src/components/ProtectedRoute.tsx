import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/components/AuthProvider";

export function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <RouteSkeleton />;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}

function RouteSkeleton() {
  return (
    <main className="min-h-screen bg-[var(--bg)] p-6">
      <div className="h-8 w-32 bg-[var(--ghost-bg)]" />
      <div className="mt-8 h-48 max-w-3xl bg-[var(--surface)] border border-[var(--border)]" />
    </main>
  );
}
