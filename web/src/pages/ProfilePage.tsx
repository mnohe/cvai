import { NavLink, useParams, useSearchParams } from "react-router-dom";

const profileTabs = [
  { to: "/profile/cv", label: "CV", section: "cv" },
  { to: "/profile/stories", label: "Stories", section: "stories" },
  { to: "/profile/portfolio", label: "Portfolio", section: "portfolio" },
] as const;

export function ProfilePage() {
  const { section = "cv" } = useParams();
  const [searchParams] = useSearchParams();
  const completionOpen = searchParams.get("completion") === "open";

  return (
    <section className="page-stack">
      <div className="page-header">
        <div>
          <h1>Profile</h1>
        </div>
      </div>

      {completionOpen && <ProfileCompletionPanel />}

      <nav className="profile-tabs" aria-label="Profile sections">
        {profileTabs.map((tab) => (
          <NavLink className="profile-tab" to={tab.to} key={tab.to}>
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <div className="empty-panel">
        <h2>{getSectionTitle(section)}</h2>
        <p className="muted">Coming soon</p>
      </div>
    </section>
  );
}

function ProfileCompletionPanel() {
  return (
    <div className="completion-panel">
      <div>
        <h2>Complete your profile</h2>
        <p className="muted">0/5</p>
      </div>
      <ul>
        <li>○ Personal details</li>
        <li>○ Work experience</li>
        <li>○ Story</li>
        <li>○ Education</li>
        <li>○ Portfolio evidence</li>
      </ul>
    </div>
  );
}

function getSectionTitle(section: string) {
  if (section === "stories") return "Stories";
  if (section === "portfolio") return "Portfolio";
  return "CV";
}
