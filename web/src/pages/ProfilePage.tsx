import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { NavLink, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "@/components/AuthProvider";
import { ThinkButton } from "@/components/ThinkButton";
import { apiFetch } from "@/lib/api";
import {
  emptyCandidateContext,
  getCVCompleteness,
  hasCertificationContent,
  hasContactContent,
  hasCVContent,
  hasEducationContent,
  hasExperienceContent,
  hasLanguageContent,
  hasText,
  joinLines,
  makeExperience,
  normaliseCV,
  splitLines,
} from "@/lib/cv";
import { db } from "@/lib/firebase";
import {
  getProfileCompletion,
  type CompletionSegment,
} from "@/lib/profileCompletion";
import type {
  CV,
  Candidate,
  Certification,
  Education,
  Language,
} from "@/lib/types";

type CVSection =
  | "personal"
  | "summary"
  | "experience"
  | "education"
  | "skills"
  | "certifications"
  | "languages"
  | "projects";

const profileTabs = [
  { to: "/profile/cv", label: "CV", section: "cv" },
  { to: "/profile/stories", label: "Stories", section: "stories" },
  { to: "/profile/portfolio", label: "Portfolio", section: "portfolio" },
] as const;

const cvSections: { id: CVSection; label: string }[] = [
  { id: "personal", label: "Personal" },
  { id: "summary", label: "Summary" },
  { id: "experience", label: "Experience" },
  { id: "education", label: "Education" },
  { id: "skills", label: "Skills" },
  { id: "certifications", label: "Certifications" },
  { id: "languages", label: "Languages" },
  { id: "projects", label: "Projects" },
];

export function ProfilePage() {
  const { section = "cv" } = useParams();
  const [searchParams] = useSearchParams();

  return (
    <section className="page-stack">
      <div className="page-header">
        <h1>Profile</h1>
      </div>
      <div>
        <nav className="profile-tabs" aria-label="Profile sections">
          {profileTabs.map((tab) => (
            <NavLink className="profile-tab" to={tab.to} key={tab.to}>
              {tab.label}
            </NavLink>
          ))}
        </nav>

        {section === "cv" ? (
          <CVProfile completionOpen={searchParams.get("completion") === "open"} />
        ) : (
          <div className="empty-panel">
            <p className="muted">Coming soon</p>
          </div>
        )}
      </div>

    </section>
  );
}

function CVProfile({ completionOpen }: { completionOpen: boolean }) {
  const { user } = useAuth();
  const [candidate, setCandidate] = useState<Partial<Candidate> | null>(null);
  const [snapshotReady, setSnapshotReady] = useState(false);
  const [started, setStarted] = useState(false);
  const [activeSection, setActiveSection] = useState<CVSection>("personal");
  const [importOpen, setImportOpen] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [completionDismissed, setCompletionDismissed] = useState(
    () => sessionStorage.getItem("cvai:completion-dismissed") === "true",
  );

  useEffect(() => {
    if (!user) {
      setCandidate(null);
      setSnapshotReady(true);
      return;
    }

    return onSnapshot(
      doc(db, "users", user.uid, "candidate", "profile"),
      (snapshot) => {
        setCandidate(
          snapshot.exists()
            ? ({ id: user.uid, ...snapshot.data() } as Partial<Candidate>)
            : null,
        );
        setSnapshotReady(true);
      },
      () => {
        setCandidate(null);
        setSnapshotReady(true);
      },
    );
  }, [user]);

  const cv = useMemo(() => normaliseCV(candidate), [candidate]);
  const completion = useMemo(() => getProfileCompletion(candidate ?? { cv }), [candidate, cv]);
  const cvCompleteness = useMemo(() => getCVCompleteness(cv), [cv]);
  const hasExistingCV = candidate?.cv ? hasCVContent(cv) : false;
  const showEditor = started || hasExistingCV;
  const showCompletionPanel =
    completion.score < 5 &&
    (completionOpen || (!completionDismissed && (started || hasExistingCV)));

  async function saveCV(nextCV: CV, sectionHasMeaningfulContent: boolean) {
    if (!user || !sectionHasMeaningfulContent) {
      setSaveMessage("Add some content before saving this section.");
      return;
    }

    await setDoc(
      doc(db, "users", user.uid, "candidate", "profile"),
      {
        cv: nextCV,
        context: candidate?.context ?? emptyCandidateContext,
        created_at: candidate?.created_at ?? serverTimestamp(),
        updated_at: serverTimestamp(),
      },
      { merge: true },
    );
    setStarted(true);
    setSaveMessage("Saved");
  }

  if (!snapshotReady) {
    return <div className="empty-panel">Loading CV...</div>;
  }

  return (
    <>
      {showCompletionPanel && (
        <ProfileCompletionPanel
          score={completion.score}
          segments={completion.segments}
          onDismiss={() => {
            sessionStorage.setItem("cvai:completion-dismissed", "true");
            setCompletionDismissed(true);
          }}
          onSection={(nextSection) => {
            if (nextSection === "stories") return;
            if (nextSection === "portfolio") return;
            setStarted(true);
            setActiveSection(nextSection);
          }}
        />
      )}

      {!showEditor ? (
        <div className="empty-panel cv-empty-state">
          <h2>You haven't added a CV yet.</h2>
          <div className="empty-actions">
            <button type="button" className="primary-rect-button" onClick={() => setStarted(true)}>
              Start from scratch
            </button>
            <ThinkButton completionScore={2} variant="ghost" onClick={() => setImportOpen(true)}>
              Import from PDF
            </ThinkButton>
          </div>
        </div>
      ) : (
        <div className="cv-editor">
          <div className="cv-completeness" aria-label="CV completeness">
            <div className="cv-panel-heading">
              <div className="cv-completeness-copy">
                <span className="label">Completeness</span>
                <strong>{cvCompleteness.percent}%</strong>
                <span className="muted">
                  {cvCompleteness.complete} of {cvCompleteness.total} section signals
                </span>
              </div>
              <button type="button" className="secondary-button" onClick={() => window.print()}>
                Export PDF
              </button>
            </div>
            <div
              className="cv-progress"
              role="progressbar"
              aria-label="CV completeness"
              aria-valuenow={cvCompleteness.percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span style={{ width: `${cvCompleteness.percent}%` }} />
            </div>
          </div>

          <nav className="cv-section-tabs" aria-label="CV editor sections">
            {cvSections.map((tab) => (
              <button
                className={activeSection === tab.id ? "cv-section-tab active" : "cv-section-tab"}
                type="button"
                key={tab.id}
                onClick={() => setActiveSection(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          {saveMessage && <p className="save-message">{saveMessage}</p>}

          <CVSectionPanel section={activeSection}>
            {activeSection === "personal" && (
              <PersonalForm cv={cv} onSave={(next) => void saveCV(next, hasContactContent(next))} />
            )}
            {activeSection === "summary" && (
              <SummaryForm cv={cv} onSave={(next) => void saveCV(next, hasText(next.summary))} />
            )}
            {activeSection === "experience" && (
              <ExperienceForm
                cv={cv}
                onSave={(next) => void saveCV(next, next.experience.some(hasExperienceContent))}
              />
            )}
            {activeSection === "education" && (
              <EducationForm
                cv={cv}
                onSave={(next) => void saveCV(next, next.education.some(hasEducationContent))}
              />
            )}
            {activeSection === "skills" && (
              <SkillsForm cv={cv} onSave={(next) => void saveCV(next, (next.skills ?? []).length > 0)} />
            )}
            {activeSection === "certifications" && (
              <CertificationsForm
                cv={cv}
                onSave={(next) => void saveCV(next, next.certifications.some(hasCertificationContent))}
              />
            )}
            {activeSection === "languages" && (
              <LanguagesForm
                cv={cv}
                onSave={(next) => void saveCV(next, next.languages.some(hasLanguageContent))}
              />
            )}
            {activeSection === "projects" && (
              <ProjectsForm
                cv={cv}
                onSave={(next) =>
                  void saveCV(
                    next,
                    hasText(next.projects.url) ||
                      next.projects.items.some((item) =>
                        [item.name, item.summary, item.url, item.description].some(hasText),
                      ),
                  )
                }
              />
            )}
          </CVSectionPanel>
        </div>
      )}

      {importOpen && <ImportCVModal onClose={() => setImportOpen(false)} />}
    </>
  );
}

function ProfileCompletionPanel({
  score,
  segments,
  onDismiss,
  onSection,
}: {
  score: number;
  segments: CompletionSegment[];
  onDismiss: () => void;
  onSection: (section: CVSection | "stories" | "portfolio") => void;
}) {
  return (
    <div className="completion-panel">
      <div className="completion-heading">
        <div>
          <h2>Complete your profile</h2>
          <p className="muted">
            {score}/5 · {score >= 2 ? "Analytics are available." : "Analytics unlock at 2/5."}
          </p>
        </div>
        <button type="button" className="icon-button" aria-label="Dismiss completion panel" onClick={onDismiss}>
          ×
        </button>
      </div>
      <ul className="completion-list">
        {segments.map((segment) => (
          <li key={segment.id}>
            <button
              type="button"
              className="completion-link"
              onClick={() => onSection(segmentToSection(segment.id))}
            >
              <span aria-hidden="true">{segment.complete ? "✓" : "○"}</span>
              <span>{segment.label}</span>
              <span className="muted">{segment.complete ? "already filled" : segmentCTA(segment.id)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function segmentToSection(id: CompletionSegment["id"]): CVSection | "stories" | "portfolio" {
  if (id === "story") return "stories";
  if (id === "evidence") return "portfolio";
  if (id === "personal") return "personal";
  if (id === "education") return "education";
  return "experience";
}

function segmentCTA(id: CompletionSegment["id"]) {
  if (id === "story") return "Add a story";
  if (id === "evidence") return "Add evidence item";
  if (id === "education") return "Add education";
  if (id === "experience") return "Add work experience";
  return "Add personal details";
}

function CVSectionPanel({ section, children }: { section: CVSection; children: ReactNode }) {
  return (
    <section className="cv-section-panel" aria-labelledby={`cv-${section}-heading`}>
      <h2 id={`cv-${section}-heading`}>{cvSections.find((item) => item.id === section)?.label}</h2>
      {children}
    </section>
  );
}

function PersonalForm({ cv, onSave }: { cv: CV; onSave: (cv: CV) => void }) {
  const [draft, setDraft] = useState(cv.contact);
  useEffect(() => setDraft(cv.contact), [cv.contact]);

  return (
    <FormShell onSubmit={() => onSave({ ...cv, contact: draft })}>
      <Field label="First name" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} />
      <Field label="Surname" value={draft.surname} onChange={(surname) => setDraft({ ...draft, surname })} />
      <Field label="Email" type="email" value={draft.email} onChange={(email) => setDraft({ ...draft, email })} />
      <Field label="Phone prefix" value={draft.phone.prefix} onChange={(prefix) => setDraft({ ...draft, phone: { ...draft.phone, prefix } })} />
      <Field label="Phone number" value={draft.phone.number} onChange={(number) => setDraft({ ...draft, phone: { ...draft.phone, number } })} />
      <Field label="LinkedIn" value={draft.linkedin} onChange={(linkedin) => setDraft({ ...draft, linkedin })} />
      <Field label="GitHub" value={draft.github ?? ""} onChange={(github) => setDraft({ ...draft, github })} />
      <Field label="Website" value={draft.www ?? ""} onChange={(www) => setDraft({ ...draft, www })} />
    </FormShell>
  );
}

function SummaryForm({ cv, onSave }: { cv: CV; onSave: (cv: CV) => void }) {
  const [summary, setSummary] = useState(cv.summary);
  useEffect(() => setSummary(cv.summary), [cv.summary]);

  return (
    <FormShell onSubmit={() => onSave({ ...cv, summary })}>
      <Textarea label="Summary" value={summary} onChange={setSummary} rows={7} />
    </FormShell>
  );
}

function ExperienceForm({ cv, onSave }: { cv: CV; onSave: (cv: CV) => void }) {
  const initial = cv.experience[0] ?? makeExperience();
  const firstPosition = initial.positions[0] ?? {
    id: crypto.randomUUID(),
    roles: [],
    start: "",
    location: "",
    tasks: [],
  };
  const [company, setCompany] = useState(initial.company);
  const [roles, setRoles] = useState(joinLines(firstPosition.roles));
  const [start, setStart] = useState(firstPosition.start);
  const [end, setEnd] = useState(firstPosition.end ?? "");
  const [location, setLocation] = useState(firstPosition.location);
  const [tasks, setTasks] = useState(joinLines(firstPosition.tasks));

  useEffect(() => {
    const next = cv.experience[0] ?? makeExperience();
    const position = next.positions[0] ?? firstPosition;
    setCompany(next.company);
    setRoles(joinLines(position.roles));
    setStart(position.start);
    setEnd(position.end ?? "");
    setLocation(position.location);
    setTasks(joinLines(position.tasks));
  }, [cv.experience]);

  return (
    <FormShell
      onSubmit={() =>
        onSave({
          ...cv,
          experience: [
            {
              company,
              positions: [
                {
                  id: firstPosition.id || crypto.randomUUID(),
                  roles: splitLines(roles),
                  start,
                  end,
                  location,
                  tasks: splitLines(tasks),
                },
              ],
            },
            ...cv.experience.slice(1),
          ],
        })
      }
    >
      <Field label="Company" value={company} onChange={setCompany} />
      <Textarea label="Roles, one per line" value={roles} onChange={setRoles} rows={3} />
      <Field label="Start" value={start} onChange={setStart} placeholder="2022-01" />
      <Field label="End" value={end} onChange={setEnd} placeholder="Present" />
      <Field label="Location" value={location} onChange={setLocation} />
      <Textarea label="Tasks and outcomes, one per line" value={tasks} onChange={setTasks} rows={6} />
    </FormShell>
  );
}

function EducationForm({ cv, onSave }: { cv: CV; onSave: (cv: CV) => void }) {
  const initial = cv.education[0] ?? { name: "", type: "", issuer: "", year: 0 };
  const [draft, setDraft] = useState<Education>(initial);
  useEffect(() => setDraft(cv.education[0] ?? initial), [cv.education]);

  return (
    <FormShell onSubmit={() => onSave({ ...cv, education: [draft, ...cv.education.slice(1)] })}>
      <Field label="Qualification" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} />
      <Field label="Type" value={draft.type ?? ""} onChange={(type) => setDraft({ ...draft, type })} />
      <Field label="Issuer" value={draft.issuer} onChange={(issuer) => setDraft({ ...draft, issuer })} />
      <Field label="Year" type="number" value={draft.year ? String(draft.year) : ""} onChange={(year) => setDraft({ ...draft, year: Number(year) || 0 })} />
    </FormShell>
  );
}

function SkillsForm({ cv, onSave }: { cv: CV; onSave: (cv: CV) => void }) {
  const [skills, setSkills] = useState(joinLines(cv.skills));
  useEffect(() => setSkills(joinLines(cv.skills)), [cv.skills]);

  return (
    <FormShell onSubmit={() => onSave({ ...cv, skills: splitLines(skills) })}>
      <Textarea label="Skills, one per line" value={skills} onChange={setSkills} rows={8} />
    </FormShell>
  );
}

function CertificationsForm({ cv, onSave }: { cv: CV; onSave: (cv: CV) => void }) {
  const initial = cv.certifications[0] ?? { name: "", id: "", issuer: "", year: 0 };
  const [draft, setDraft] = useState<Certification>(initial);
  useEffect(() => setDraft(cv.certifications[0] ?? initial), [cv.certifications]);

  return (
    <FormShell onSubmit={() => onSave({ ...cv, certifications: [draft, ...cv.certifications.slice(1)] })}>
      <Field label="Certification" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} />
      <Field label="Credential ID" value={draft.id} onChange={(id) => setDraft({ ...draft, id })} />
      <Field label="Issuer" value={draft.issuer} onChange={(issuer) => setDraft({ ...draft, issuer })} />
      <Field label="Year" type="number" value={draft.year ? String(draft.year) : ""} onChange={(year) => setDraft({ ...draft, year: Number(year) || 0 })} />
    </FormShell>
  );
}

function LanguagesForm({ cv, onSave }: { cv: CV; onSave: (cv: CV) => void }) {
  const initial = cv.languages[0] ?? { name: "", level: "" };
  const [draft, setDraft] = useState<Language>(initial);
  useEffect(() => setDraft(cv.languages[0] ?? initial), [cv.languages]);

  return (
    <FormShell onSubmit={() => onSave({ ...cv, languages: [draft, ...cv.languages.slice(1)] })}>
      <Field label="Language" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} />
      <Field label="Level" value={draft.level} onChange={(level) => setDraft({ ...draft, level })} />
    </FormShell>
  );
}

function ProjectsForm({ cv, onSave }: { cv: CV; onSave: (cv: CV) => void }) {
  const initial = cv.projects.items[0] ?? {
    name: "",
    summary: "",
    url: "",
    description: "",
  };
  const [portfolioURL, setPortfolioURL] = useState(cv.projects.url ?? "");
  const [draft, setDraft] = useState(initial);
  useEffect(() => {
    setPortfolioURL(cv.projects.url ?? "");
    setDraft(cv.projects.items[0] ?? initial);
  }, [cv.projects]);

  return (
    <FormShell
      onSubmit={() =>
        onSave({
          ...cv,
          projects: {
            url: portfolioURL,
            items: [draft, ...cv.projects.items.slice(1)],
          },
        })
      }
    >
      <Field label="Portfolio URL" value={portfolioURL} onChange={setPortfolioURL} />
      <Field label="Project name" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} />
      <Field label="Project URL" value={draft.url} onChange={(url) => setDraft({ ...draft, url })} />
      <Textarea label="Project summary" value={draft.summary} onChange={(summary) => setDraft({ ...draft, summary })} rows={3} />
      <Textarea label="Project description" value={draft.description} onChange={(description) => setDraft({ ...draft, description })} rows={5} />
    </FormShell>
  );
}

function FormShell({ children, onSubmit }: { children: ReactNode; onSubmit: () => void }) {
  return (
    <form
      className="cv-form"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="cv-form-grid">{children}</div>
      <button type="submit" className="primary-rect-button">
        Save section
      </button>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function Textarea({
  label,
  value,
  onChange,
  rows,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows: number;
}) {
  return (
    <label className="field field-wide">
      <span>{label}</span>
      <textarea value={value} rows={rows} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function ImportCVModal({ onClose }: { onClose: () => void }) {
  const [message, setMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload() {
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setMessage("Choose a PDF first.");
      return;
    }

    const body = new FormData();
    body.append("pdf", file);

    try {
      await apiFetch("/cv/imports", { method: "POST", body });
      setMessage("Import started.");
    } catch {
      setMessage("Import is not available yet.");
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card" role="dialog" aria-modal="true" aria-label="Import CV from PDF">
        <div className="panel-row">
          <div>
            <h2>Import from PDF</h2>
            <p className="muted">Upload a PDF CV when imports are enabled.</p>
          </div>
          <button type="button" className="icon-button" aria-label="Close import modal" onClick={onClose}>
            ×
          </button>
        </div>
        <input ref={inputRef} type="file" accept="application/pdf" />
        {message && <p className="muted">{message}</p>}
        <div className="panel-actions">
          <ThinkButton completionScore={2} onClick={() => void upload()}>
            Start import
          </ThinkButton>
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}
