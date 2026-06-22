import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { NavLink, useLocation, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "@/components/AuthProvider";
import type { CVPrintTemplate } from "@/components/CVPrintTemplates";
import { CVPrintPreviewDialog } from "@/components/CVPrintPreviewDialog";
import { ImportCVModal } from "@/components/ImportCVModal";
import { ThinkButton } from "@/components/ThinkButton";
import {
  emptyCandidateContext,
  hasCertificationContent,
  hasContactContent,
  hasCVContent,
  hasEducationContent,
  hasExperienceContent,
  hasLanguageContent,
  hasText,
  joinLines,
  makeExperience,
  makePosition,
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
  CVPosition,
  Candidate,
  Certification,
  Education,
  Experience,
  Language,
} from "@/lib/types";

type CVSection =
  | "personal"
  | "summary"
  | "experience"
  | "education"
  | "skills"
  | "certifications"
  | "languages";

const profileTabs = [
  { to: "/profile/cv", label: "CV", section: "cv" },
  { to: "/profile/preferences", label: "Preferences", section: "preferences" },
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
];

export function ProfilePage() {
  const { section = "cv" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [candidate, setCandidate] = useState<Partial<Candidate> | null>(null);
  const [snapshotReady, setSnapshotReady] = useState(false);
  const [completionDismissed, setCompletionDismissed] = useState(
    () => sessionStorage.getItem("cvai:completion-dismissed") === "true",
  );
  const [requestedCVSection, setRequestedCVSection] = useState<CVSection | null>(null);

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
  const showCompletionPanel = completion.score < 5 && !completionDismissed;

  useEffect(() => {
    if (!isCompletionOpenNavigation(location.state)) return;
    sessionStorage.removeItem("cvai:completion-dismissed");
    setCompletionDismissed(false);
  }, [location.state]);

  function handleCompletionSection(nextSection: CVSection | "stories" | "portfolio") {
    if (nextSection === "stories" || nextSection === "portfolio") {
      void navigate(`/profile/${nextSection}`);
      return;
    }
    setRequestedCVSection(nextSection);
    void navigate("/profile/cv");
  }

  return (
    <section className="page-stack">
      <div className="page-header">
        <h1>
          Profile
          {!showCompletionPanel && completion.score < 5 && (
            <>
              {" "}
              <a
                href="#profile-completion"
                className="profile-completion-diamonds"
                aria-label={`Show profile completion details, ${completion.score} of 5 complete`}
                onClick={(event) => {
                  event.preventDefault();
                  sessionStorage.removeItem("cvai:completion-dismissed");
                  setCompletionDismissed(false);
                }}
              >
                {completion.segments.map((segment) => (
                  <svg
                    className={segment.complete ? "completion-diamond complete" : "completion-diamond missing"}
                    key={segment.id}
                    viewBox="0 0 12 12"
                    aria-hidden="true"
                  >
                    <path d="M6 1 L11 6 L6 11 L1 6 Z" />
                  </svg>
                ))}
              </a>
            </>
          )}
        </h1>
      </div>
      {showCompletionPanel && (
        <ProfileCompletionPanel
          score={completion.score}
          segments={completion.segments}
          onDismiss={() => {
            sessionStorage.setItem("cvai:completion-dismissed", "true");
            setCompletionDismissed(true);
          }}
          onSection={handleCompletionSection}
        />
      )}
      <div>
        <nav className="section-tabs" aria-label="Profile sections">
          {profileTabs.map((tab) => (
            <NavLink className="section-tab" to={tab.to} key={tab.to}>
              {tab.label}
            </NavLink>
          ))}
        </nav>

        {section === "cv" ? (
          <CVProfile
            candidate={candidate}
            snapshotReady={snapshotReady}
            requestedSection={requestedCVSection}
            onRequestedSectionHandled={() => setRequestedCVSection(null)}
          />
        ) : section === "preferences" ? (
          <PreferencesProfile candidate={candidate} snapshotReady={snapshotReady} />
        ) : (
          <div className="tab-content empty-panel">
            <p className="muted">Coming soon</p>
          </div>
        )}
      </div>

    </section>
  );
}

function CVProfile({
  candidate,
  snapshotReady,
  requestedSection,
  onRequestedSectionHandled,
}: {
  candidate: Partial<Candidate> | null;
  snapshotReady: boolean;
  requestedSection: CVSection | null;
  onRequestedSectionHandled: () => void;
}) {
  const { user } = useAuth();
  const [started, setStarted] = useState(false);
  const [activeSection, setActiveSection] = useState<CVSection>("personal");
  const [importOpen, setImportOpen] = useState(false);
  const [printOpen, setPrintOpen] = useState(false);
  const [printTemplate, setPrintTemplate] = useState<CVPrintTemplate>("default");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const cv = useMemo(() => normaliseCV(candidate), [candidate]);
  const hasExistingCV = candidate?.cv ? hasCVContent(cv) : false;
  const showEditor = started || hasExistingCV;

  useEffect(() => {
    if (!requestedSection) return;
    setStarted(true);
    setActiveSection(requestedSection);
    onRequestedSectionHandled();
  }, [onRequestedSectionHandled, requestedSection]);

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

  useEffect(() => {
    setSaveMessage(null);
  }, [activeSection]);

  if (!snapshotReady) {
    return <div className="tab-content empty-panel">Loading CV...</div>;
  }

  return (
    <>
      {!showEditor ? (
        <div className="tab-content empty-panel cv-empty-state">
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
        <div className="tab-content cv-panel">
          <div className="cv-panel-actions">
            <button type="button" className="secondary-button" onClick={() => setPrintOpen(true)}>
              Print
            </button>
            <ThinkButton completionScore={2} variant="ghost" onClick={() => setImportOpen(true)}>
              Import from PDF
            </ThinkButton>
          </div>

          <div className="cv-section">

            <nav className="section-tabs section-tabs-small" aria-label="CV editor sections">
              {cvSections.map((tab) => (
                <button
                  className={activeSection === tab.id ? "section-tab active" : "section-tab"}
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
            </CVSectionPanel>
          </div>
        </div>
      )}

      {importOpen && (
        <ImportCVModal
          onClose={() => setImportOpen(false)}
          onImported={() => {
            setStarted(true);
          }}
          replacingExisting={hasExistingCV}
        />
      )}
      {printOpen && (
        <CVPrintPreviewDialog
          cv={cv}
          template={printTemplate}
          onTemplateChange={setPrintTemplate}
          onClose={() => setPrintOpen(false)}
        />
      )}
    </>
  );
}

function PreferencesProfile({
  candidate,
  snapshotReady,
}: {
  candidate: Partial<Candidate> | null;
  snapshotReady: boolean;
}) {
  const { user } = useAuth();
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  async function savePreferences(preferences: string) {
    if (!user) return;
    try {
      await setDoc(
        doc(db, "users", user.uid, "candidate", "profile"),
        {
          preferences,
          updated_at: serverTimestamp(),
        },
        { merge: true },
      );
      setSaveMessage("Saved");
    } catch {
      setSaveMessage("Could not save preferences.");
    }
  }

  if (!snapshotReady) {
    return <div className="tab-content empty-panel">Loading preferences...</div>;
  }

  return (
    <section className="tab-content preferences-panel" aria-labelledby="preferences-heading">
      {saveMessage && <p className="save-message">{saveMessage}</p>}
      <h2 id="preferences-heading">Preferences</h2>
      <PreferencesForm
        preferences={candidate?.preferences ?? ""}
        onSave={(preferences) => void savePreferences(preferences)}
      />
    </section>
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

function isCompletionOpenNavigation(state: unknown): state is { openCompletionPanel: number } {
  return (
    typeof state === "object" &&
    state !== null &&
    "openCompletionPanel" in state &&
    typeof (state as { openCompletionPanel?: unknown }).openCompletionPanel === "number"
  );
}

function CVSectionPanel({ section, children }: { section: CVSection; children: ReactNode }) {
  return (
    <section className="section-panel cv-section-panel" aria-labelledby={`cv-${section}-heading`}>
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
  const [items, setItems] = useState(() => normaliseExperienceList(cv.experience));
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedPositionIndex, setSelectedPositionIndex] = useState(0);

  useEffect(() => {
    setItems(normaliseExperienceList(cv.experience));
    setSelectedIndex(0);
    setSelectedPositionIndex(0);
  }, [cv.experience]);

  const selectedExperience = items[selectedIndex] ?? makeExperience();
  const selectedPosition = selectedExperience.positions[selectedPositionIndex] ?? makePosition();

  function updateSelectedExperience(next: Experience) {
    setItems((current) => current.map((item, index) => (index === selectedIndex ? next : item)));
  }

  function updateSelectedPosition(nextPosition: CVPosition) {
    updateSelectedExperience({
      ...selectedExperience,
      positions: selectedExperience.positions.map((position, index) =>
        index === selectedPositionIndex ? nextPosition : position,
      ),
    });
  }

  function addExperience() {
    setItems((current) => [...current, makeExperience()]);
    setSelectedIndex(items.length);
    setSelectedPositionIndex(0);
  }

  function removeExperience() {
    if (items.length === 1) return;
    const nextItems = items.filter((_, index) => index !== selectedIndex);
    setItems(nextItems);
    setSelectedIndex(Math.max(0, selectedIndex - 1));
    setSelectedPositionIndex(0);
  }

  function addPosition() {
    updateSelectedExperience({
      ...selectedExperience,
      positions: [...selectedExperience.positions, makePosition()],
    });
    setSelectedPositionIndex(selectedExperience.positions.length);
  }

  function removePosition() {
    if (selectedExperience.positions.length === 1) return;
    updateSelectedExperience({
      ...selectedExperience,
      positions: selectedExperience.positions.filter((_, index) => index !== selectedPositionIndex),
    });
    setSelectedPositionIndex(Math.max(0, selectedPositionIndex - 1));
  }

  return (
    <FormShell onSubmit={() => onSave({ ...cv, experience: items })}>
      <EntryControls
        label="Experience entry"
        entries={items}
        selectedIndex={selectedIndex}
        onSelect={(index) => {
          setSelectedIndex(index);
          setSelectedPositionIndex(0);
        }}
        onAdd={addExperience}
        onRemove={removeExperience}
        renderLabel={(experience, index) =>
          entryLabel("Experience", index, joinText([experience.company, experience.positions[0]?.roles?.[0]], " - "))
        }
      />
      <Field
        label="Company"
        value={selectedExperience.company}
        onChange={(company) => updateSelectedExperience({ ...selectedExperience, company })}
      />
      <EntryControls
        label="Position"
        entries={selectedExperience.positions}
        selectedIndex={selectedPositionIndex}
        onSelect={setSelectedPositionIndex}
        onAdd={addPosition}
        onRemove={removePosition}
        renderLabel={(position, index) => entryLabel("Position", index, joinText(position.roles))}
      />
      <Textarea
        label="Roles, one per line"
        value={joinLines(selectedPosition.roles)}
        onChange={(roles) => updateSelectedPosition({ ...selectedPosition, roles: splitLines(roles) })}
        rows={3}
      />
      <Field
        label="Start"
        value={selectedPosition.start}
        onChange={(start) => updateSelectedPosition({ ...selectedPosition, start })}
        placeholder="2022-01"
      />
      <Field
        label="End"
        value={selectedPosition.end ?? ""}
        onChange={(end) => updateSelectedPosition({ ...selectedPosition, end })}
        placeholder="Present"
      />
      <Field
        label="Location"
        value={selectedPosition.location}
        onChange={(location) => updateSelectedPosition({ ...selectedPosition, location })}
      />
      <Textarea
        label="Tasks and outcomes, one per line"
        value={joinLines(selectedPosition.tasks)}
        onChange={(tasks) => updateSelectedPosition({ ...selectedPosition, tasks: splitLines(tasks) })}
        rows={6}
      />
    </FormShell>
  );
}

function EducationForm({ cv, onSave }: { cv: CV; onSave: (cv: CV) => void }) {
  const [items, setItems] = useState<Education[]>(cv.education.length ? cv.education : [emptyEducation()]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  useEffect(() => {
    setItems(cv.education.length ? cv.education : [emptyEducation()]);
    setSelectedIndex(0);
  }, [cv.education]);
  const draft = items[selectedIndex] ?? emptyEducation();

  function updateDraft(next: Education) {
    setItems((current) => current.map((item, index) => (index === selectedIndex ? next : item)));
  }

  return (
    <FormShell onSubmit={() => onSave({ ...cv, education: items })}>
      <EntryControls
        label="Education entry"
        entries={items}
        selectedIndex={selectedIndex}
        onSelect={setSelectedIndex}
        onAdd={() => {
          setItems((current) => [...current, emptyEducation()]);
          setSelectedIndex(items.length);
        }}
        onRemove={() => {
          if (items.length === 1) return;
          setItems((current) => current.filter((_, index) => index !== selectedIndex));
          setSelectedIndex(Math.max(0, selectedIndex - 1));
        }}
        renderLabel={(education, index) => entryLabel("Education", index, joinText([education.name, education.issuer]))}
      />
      <Field label="Qualification" value={draft.name} onChange={(name) => updateDraft({ ...draft, name })} />
      <Field label="Type" value={draft.type ?? ""} onChange={(type) => updateDraft({ ...draft, type })} />
      <Field label="Issuer" value={draft.issuer} onChange={(issuer) => updateDraft({ ...draft, issuer })} />
      <Field label="Year" type="number" value={draft.year ? String(draft.year) : ""} onChange={(year) => updateDraft({ ...draft, year: Number(year) || 0 })} />
    </FormShell>
  );
}

function SkillsForm({ cv, onSave }: { cv: CV; onSave: (cv: CV) => void }) {
  const [skills, setSkills] = useState<string[]>(cv.skills?.length ? cv.skills : [""]);
  useEffect(() => setSkills(cv.skills?.length ? cv.skills : [""]), [cv.skills]);

  function updateSkill(index: number, value: string) {
    setSkills((current) => current.map((skill, skillIndex) => (skillIndex === index ? value : skill)));
  }

  function removeSkill(index: number) {
    setSkills((current) => current.filter((_, skillIndex) => skillIndex !== index));
  }

  return (
    <FormShell onSubmit={() => onSave({ ...cv, skills: skills.map((skill) => skill.trim()).filter(Boolean) })}>
      <div className="editable-list field-wide">
        {skills.map((skill, index) => (
          <div className="editable-list-row" key={index}>
            <Field label={`Skill ${index + 1}`} value={skill} onChange={(value) => updateSkill(index, value)} />
            <button type="button" className="secondary-button" onClick={() => removeSkill(index)} disabled={skills.length === 1}>
              Remove
            </button>
          </div>
        ))}
        <button type="button" className="secondary-button" onClick={() => setSkills((current) => [...current, ""])}>
          Add skill
        </button>
      </div>
    </FormShell>
  );
}

function emptyEducation(): Education {
  return { name: "", type: "", issuer: "", year: 0 };
}

function emptyCertification(): Certification {
  return { name: "", id: "", issuer: "", year: 0 };
}

function emptyLanguage(): Language {
  return { name: "", level: "" };
}

function CertificationsForm({ cv, onSave }: { cv: CV; onSave: (cv: CV) => void }) {
  const [items, setItems] = useState<Certification[]>(cv.certifications.length ? cv.certifications : [emptyCertification()]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  useEffect(() => {
    setItems(cv.certifications.length ? cv.certifications : [emptyCertification()]);
    setSelectedIndex(0);
  }, [cv.certifications]);
  const draft = items[selectedIndex] ?? emptyCertification();

  function updateDraft(next: Certification) {
    setItems((current) => current.map((item, index) => (index === selectedIndex ? next : item)));
  }

  return (
    <FormShell onSubmit={() => onSave({ ...cv, certifications: items })}>
      <EntryControls
        label="Certification entry"
        entries={items}
        selectedIndex={selectedIndex}
        onSelect={setSelectedIndex}
        onAdd={() => {
          setItems((current) => [...current, emptyCertification()]);
          setSelectedIndex(items.length);
        }}
        onRemove={() => {
          if (items.length === 1) return;
          setItems((current) => current.filter((_, index) => index !== selectedIndex));
          setSelectedIndex(Math.max(0, selectedIndex - 1));
        }}
        renderLabel={(certification, index) =>
          entryLabel("Certification", index, joinText([certification.name, certification.issuer]))
        }
      />
      <Field label="Certification" value={draft.name} onChange={(name) => updateDraft({ ...draft, name })} />
      <Field label="Credential ID" value={draft.id} onChange={(id) => updateDraft({ ...draft, id })} />
      <Field label="Issuer" value={draft.issuer} onChange={(issuer) => updateDraft({ ...draft, issuer })} />
      <Field label="Year" type="number" value={draft.year ? String(draft.year) : ""} onChange={(year) => updateDraft({ ...draft, year: Number(year) || 0 })} />
    </FormShell>
  );
}

function LanguagesForm({ cv, onSave }: { cv: CV; onSave: (cv: CV) => void }) {
  const [items, setItems] = useState<Language[]>(cv.languages.length ? cv.languages : [emptyLanguage()]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  useEffect(() => {
    setItems(cv.languages.length ? cv.languages : [emptyLanguage()]);
    setSelectedIndex(0);
  }, [cv.languages]);
  const draft = items[selectedIndex] ?? emptyLanguage();

  function updateDraft(next: Language) {
    setItems((current) => current.map((item, index) => (index === selectedIndex ? next : item)));
  }

  return (
    <FormShell onSubmit={() => onSave({ ...cv, languages: items })}>
      <EntryControls
        label="Language entry"
        entries={items}
        selectedIndex={selectedIndex}
        onSelect={setSelectedIndex}
        onAdd={() => {
          setItems((current) => [...current, emptyLanguage()]);
          setSelectedIndex(items.length);
        }}
        onRemove={() => {
          if (items.length === 1) return;
          setItems((current) => current.filter((_, index) => index !== selectedIndex));
          setSelectedIndex(Math.max(0, selectedIndex - 1));
        }}
        renderLabel={(language, index) => entryLabel("Language", index, joinText([language.name, language.level]))}
      />
      <Field label="Language" value={draft.name} onChange={(name) => updateDraft({ ...draft, name })} />
      <Field label="Level" value={draft.level} onChange={(level) => updateDraft({ ...draft, level })} />
    </FormShell>
  );
}

function PreferencesForm({
  preferences,
  onSave,
}: {
  preferences: string;
  onSave: (preferences: string) => void;
}) {
  const [draft, setDraft] = useState(preferences);
  const isEditing = useRef(false);

  useEffect(() => {
    if (!isEditing.current) {
      setDraft(preferences);
    }
  }, [preferences]);

  const count = draft.length;

  return (
    <label className="field field-wide">
      <span>Preferences and constraints</span>
      <textarea
        value={draft}
        rows={8}
        placeholder="What matters to you in your next role? Remote work, salary range, sectors you prefer or avoid, anything else the AI should know when assessing roles."
        onFocus={() => {
          isEditing.current = true;
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          isEditing.current = false;
          onSave(draft);
        }}
      />
      <span className={count > 1800 ? "preference-count preference-count-warning" : "preference-count"}>
        {count}/2000
      </span>
    </label>
  );
}

function EntryControls<T>({
  label,
  entries,
  selectedIndex,
  onSelect,
  onAdd,
  onRemove,
  renderLabel,
}: {
  label: string;
  entries: T[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onAdd: () => void;
  onRemove: () => void;
  renderLabel: (entry: T, index: number) => string;
}) {
  return (
    <div className="entry-controls field-wide">
      <label className="field">
        <span>{label}</span>
        <select value={selectedIndex} onChange={(event) => onSelect(Number(event.target.value))}>
          {entries.map((entry, index) => (
            <option value={index} key={index}>
              {renderLabel(entry, index)}
            </option>
          ))}
        </select>
      </label>
      <div className="entry-actions">
        <button type="button" className="secondary-button" onClick={onAdd}>
          Add
        </button>
        <button type="button" className="secondary-button" onClick={onRemove} disabled={entries.length === 1}>
          Remove
        </button>
      </div>
    </div>
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

function joinText(parts: Array<string | undefined>, separator = " | ") {
  return parts.filter(hasText).join(separator);
}

function entryLabel(fallback: string, index: number, label: string) {
  return `${index + 1}. ${hasText(label) ? label : fallback}`;
}

function normaliseExperienceList(experience: Experience[]) {
  const items = experience.length ? experience : [makeExperience()];
  return items.map((item) => ({
    ...item,
    positions: item.positions.length ? item.positions : [makePosition()],
  }));
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
