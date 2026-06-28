import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { AccountPanel } from "@/components/AccountPanel";
import { LogoMark } from "@/components/LogoMark";
import { ProfileCompletionMeter } from "@/components/ProfileCompletionMeter";
import { useAuth } from "@/components/AuthProvider";

const navItems = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/roles", label: "Roles" },
  { to: "/profile", label: "Profile" },
  { to: "/tasks", label: "Tasks" },
];

export function Shell() {
  const [accountOpen, setAccountOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <LogoMark mode="dark" />
        <nav aria-label="Primary">
          {navItems.map((item) => (
            <NavLink
              className="side-link"
              to={item.to}
              key={item.to}
              end={item.to === "/dashboard"}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-user">
          <span className="user-line">
            <button
              className="user-account-trigger"
              aria-label="Open account panel"
              type="button"
              onClick={() => setAccountOpen(true)}
            >
              <span className="user-copy">
                {user?.displayName || "CVAI user"}
                <span className="user-email">{user?.email}</span>
              </span>
            </button>
            <ProfileCompletionMeter compact />
            <button
              className="settings-trigger"
              aria-label="Open settings"
              type="button"
              onClick={() => navigate("/settings")}
            />
          </span>
        </div>
      </aside>

      <header className="top-nav">
        <button
          className="icon-button"
          type="button"
          aria-label="Open navigation"
          onClick={() => setMobileOpen((open) => !open)}
        >
          ☰
        </button>
        <LogoMark />
        <button
          className="avatar-button"
          type="button"
          aria-label="Open account"
          onClick={() => setAccountOpen(true)}
        >
          <span className="avatar-diamond">
            {getInitials(user?.displayName, user?.email)}
          </span>
        </button>
      </header>

      {mobileOpen && (
        <nav className="mobile-nav" aria-label="Primary mobile">
          {navItems.map((item) => (
            <NavLink
              className="mobile-link"
              to={item.to}
              key={item.to}
              end={item.to === "/dashboard"}
              onClick={() => setMobileOpen(false)}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      )}

      <main className="shell-main">
        <Outlet />
      </main>

      {accountOpen && <AccountPanel onClose={() => setAccountOpen(false)} />}
    </div>
  );
}

function getInitials(name?: string | null, email?: string | null) {
  const source = name || email || "CV";
  return source
    .split(/\s|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}
