import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import {
  useEffect,
  useMemo,
  useId,
  useRef,
  useState,
  type DragEvent,
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
  hasCVContent,
  hasText,
  joinLines,
  makeExperience,
  makePosition,
  normaliseCV,
  splitLines,
  validateCV,
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

type SaveState = {
  status: "idle" | "saving" | "saved" | "error";
  message?: string;
};

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
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  const saveStateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cv = useMemo(() => normaliseCV(candidate), [candidate]);
  const hasExistingCV = candidate?.cv ? hasCVContent(cv) : false;
  const showEditor = started || hasExistingCV;
  const cvValidationErrors = candidate?.cv_validation_errors ?? [];

  useEffect(() => {
    if (!requestedSection) return;
    setStarted(true);
    setActiveSection(requestedSection);
    onRequestedSectionHandled();
  }, [onRequestedSectionHandled, requestedSection]);

  useEffect(() => {
    return () => {
      if (saveStateTimer.current) {
        clearTimeout(saveStateTimer.current);
      }
    };
  }, []);

  async function saveCV(nextCV: CV) {
    if (saveStateTimer.current) {
      clearTimeout(saveStateTimer.current);
      saveStateTimer.current = null;
    }
    if (!user) {
      return;
    }

    const validationErrors = validateCV(nextCV);
    setSaveState({ status: "saving" });
    await setDoc(
      doc(db, "users", user.uid, "candidate", "profile"),
      {
        cv: nextCV,
        cv_validation_errors: validationErrors,
        context: candidate?.context ?? emptyCandidateContext,
        created_at: candidate?.created_at ?? serverTimestamp(),
        updated_at: serverTimestamp(),
      },
      { merge: true },
    );
    setStarted(true);
    setSaveState({ status: "saved" });
    saveStateTimer.current = setTimeout(() => {
      setSaveState({ status: "idle" });
      saveStateTimer.current = null;
    }, 1400);
  }

  useEffect(() => {
    if (saveStateTimer.current) {
      clearTimeout(saveStateTimer.current);
      saveStateTimer.current = null;
    }
    setSaveState({ status: "idle" });
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
          {cvValidationErrors.length > 0 && (
            <div className="cv-validation-notice" role="alert">
              <h4>These fields are missing</h4>
              <p className="notice">Please be aware that features requiring the CV will be disabled until they are provided.</p>
              <ul>
                {formatCVValidationErrors(cv, cvValidationErrors).map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="cv-panel-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setPrintOpen(true)}
              disabled={cvValidationErrors.length > 0}
              title={cvValidationErrors.length > 0 ? "Fix the incomplete fields before printing" : undefined}
            >
              Print
            </button>
            <ThinkButton completionScore={2} variant="ghost" onClick={() => setImportOpen(true)}>
              Import from PDF
            </ThinkButton>
          </div>

          <div className="cv-section" data-save-status={saveState.status}>

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

            <CVSectionPanel
              section={activeSection}
              showHeading={!["experience", "education", "certifications", "languages"].includes(activeSection)}
            >
              {activeSection === "personal" && (
                <PersonalForm cv={cv} saveState={saveState} onSave={(next) => void saveCV(next)} />
              )}
              {activeSection === "summary" && (
                <SummaryForm cv={cv} saveState={saveState} onSave={(next) => void saveCV(next)} />
              )}
              {activeSection === "experience" && (
                <ExperienceForm
                  cv={cv}
                  saveState={saveState}
                  onSave={(next) => void saveCV(next)}
                />
              )}
              {activeSection === "education" && (
                <EducationForm
                  cv={cv}
                  saveState={saveState}
                  onSave={(next) => void saveCV(next)}
                />
              )}
              {activeSection === "skills" && (
                <SkillsForm cv={cv} saveState={saveState} onSave={(next) => void saveCV(next)} />
              )}
              {activeSection === "certifications" && (
                <CertificationsForm
                  cv={cv}
                  saveState={saveState}
                  onSave={(next) => void saveCV(next)}
                />
              )}
              {activeSection === "languages" && (
                <LanguagesForm
                  cv={cv}
                  saveState={saveState}
                  onSave={(next) => void saveCV(next)}
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
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  const saveStateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function savePreferences(preferences: string) {
    if (!user) return;
    if (saveStateTimer.current) {
      clearTimeout(saveStateTimer.current);
      saveStateTimer.current = null;
    }
    setSaveState({ status: "saving" });
    try {
      await setDoc(
        doc(db, "users", user.uid, "candidate", "profile"),
        {
          preferences,
          updated_at: serverTimestamp(),
        },
        { merge: true },
      );
      setSaveState({ status: "saved" });
      saveStateTimer.current = setTimeout(() => {
        setSaveState({ status: "idle" });
        saveStateTimer.current = null;
      }, 1400);
    } catch {
      setSaveState({ status: "error", message: "Could not save preferences." });
    }
  }

  useEffect(() => {
    return () => {
      if (saveStateTimer.current) {
        clearTimeout(saveStateTimer.current);
      }
    };
  }, []);

  if (!snapshotReady) {
    return <div className="tab-content empty-panel">Loading preferences...</div>;
  }

  return (
    <section className="tab-content preferences-panel" aria-labelledby="preferences-heading">
      <h2 id="preferences-heading">Preferences</h2>
      <PreferencesForm
        preferences={candidate?.preferences ?? ""}
        saveState={saveState}
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
              className={segment.complete ? "completion-link completion-link-complete" : "completion-link completion-link-incomplete"}
              onClick={() => onSection(segmentToSection(segment.id))}
            >
              <span aria-hidden="true">{segment.complete ? "✓" : "○"}</span>
              <span>{segment.label}</span>
              <span className="muted">{segment.complete ? "complete" : segmentCTA(segment.id)}</span>
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

function CVSectionPanel({
  section,
  children,
  showHeading = true,
}: {
  section: CVSection;
  children: ReactNode;
  showHeading?: boolean;
}) {
  const label = cvSections.find((item) => item.id === section)?.label ?? section;
  return (
    <section
      className="section-panel cv-section-panel"
      aria-label={showHeading ? undefined : label}
      aria-labelledby={showHeading ? `cv-${section}-heading` : undefined}
    >
      {showHeading && <h2 id={`cv-${section}-heading`}>{label}</h2>}
      {children}
    </section>
  );
}

function PersonalForm({ cv, saveState, onSave }: { cv: CV; saveState: SaveState; onSave: (cv: CV) => void }) {
  const [draft, setDraft] = useState(cv.contact);
  const [draggedLinkIndex, setDraggedLinkIndex] = useState<number | null>(null);
  useEffect(() => setDraft(cv.contact), [cv.contact]);

  function reorderLinks(from: number | null, to: number) {
    if (from === null) return;
    setDraft((current) => ({ ...current, links: moveItem(current.links, from, to) }));
  }

  return (
    <FormShell
      saveState={saveState}
      onSubmit={() =>
        onSave({
          ...cv,
          contact: {
            name: draft.name,
            surname: draft.surname,
            phone: draft.phone,
            email: draft.email,
            links: draft.links.filter((link) => hasText(link.label) || hasText(link.url)),
          },
        })
      }
    >
      <Field label="First name" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} />
      <Field label="Surname" value={draft.surname} onChange={(surname) => setDraft({ ...draft, surname })} />
      <Field label="Email" type="email" value={draft.email} onChange={(email) => setDraft({ ...draft, email })} />
      <Field label="Phone prefix" value={draft.phone.prefix} onChange={(prefix) => setDraft({ ...draft, phone: { ...draft.phone, prefix } })} />
      <Field label="Phone number" value={draft.phone.number} onChange={(number) => setDraft({ ...draft, phone: { ...draft.phone, number } })} />
      <div className="editable-list field-wide">
        <h3 className="field-group-title">Links</h3>
        {draft.links.map((link, index) => (
          <div
            className="editable-list-row editable-list-row-three draggable-list-row"
            key={index}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => reorderLinks(draggedLinkIndex, index)}
          >
            <DragHandle
              label={`Move link entry ${index + 1}`}
              onDragStart={(event) => {
                startDrag(event, index);
                setDraggedLinkIndex(index);
              }}
              onDragEnd={() => setDraggedLinkIndex(null)}
            />
            <Field
              label="Label"
              accessibleLabel={`Link ${index + 1} label`}
              name={`contact-link-${index + 1}-label`}
              value={link.label}
              placeholder="LinkedIn, My portfolio, GitHub"
              onChange={(label) =>
                setDraft({
                  ...draft,
                  links: draft.links.map((item, itemIndex) => (itemIndex === index ? { ...item, label } : item)),
                })
              }
            />
            <Field
              label="URL"
              accessibleLabel={`Link ${index + 1} URL`}
              name={`contact-link-${index + 1}-url`}
              value={link.url}
              placeholder="https://linkedin.com/in/my-user"
              onChange={(url) =>
                setDraft({
                  ...draft,
                  links: draft.links.map((item, itemIndex) => (itemIndex === index ? { ...item, url } : item)),
                })
              }
            />
            <button
              type="button"
              className="secondary-button"
              onClick={() => setDraft({ ...draft, links: draft.links.filter((_, linkIndex) => linkIndex !== index) })}
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className="secondary-button"
          onClick={() => setDraft({ ...draft, links: [{ label: "", url: "" }, ...draft.links] })}
        >
          Add link
        </button>
      </div>
    </FormShell>
  );
}

function SummaryForm({ cv, saveState, onSave }: { cv: CV; saveState: SaveState; onSave: (cv: CV) => void }) {
  const [summary, setSummary] = useState(cv.summary);
  useEffect(() => setSummary(cv.summary), [cv.summary]);

  return (
    <FormShell saveState={saveState} onSubmit={() => onSave({ ...cv, summary })}>
      <Textarea label="Summary" value={summary} onChange={setSummary} rows={7} />
    </FormShell>
  );
}

function ExperienceForm({ cv, saveState, onSave }: { cv: CV; saveState: SaveState; onSave: (cv: CV) => void }) {
  const [items, setItems] = useState(() => normaliseExperienceList(cv.experience));
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<Experience | null>(null);
  const [removeIndex, setRemoveIndex] = useState<number | null>(null);

  useEffect(() => {
    setItems(sortExperienceEntries(normaliseExperienceList(cv.experience)));
    setEditingIndex(null);
    setDraft(null);
  }, [cv.experience]);

  const editingExisting = editingIndex !== null && editingIndex >= 0 && editingIndex < items.length;
  const selectedExperience = draft ?? makeExperience();

  function updateSelectedExperience(next: Experience) {
    setDraft(next);
  }

  function updatePosition(positionIndex: number, nextPosition: CVPosition) {
    updateSelectedExperience({
      ...selectedExperience,
      positions: selectedExperience.positions.map((position, index) =>
        index === positionIndex ? nextPosition : position,
      ),
    });
  }

  function addExperience() {
    setEditingIndex(-1);
    setDraft(makeExperience());
  }

  function editExperience(index: number) {
    setEditingIndex(index);
    setDraft(items[index] ?? makeExperience());
  }

  function saveExperience() {
    if (editingIndex === null || !draft) return;
    const nextItems = editingExisting
      ? items.map((item, index) => (index === editingIndex ? draft : item))
      : [draft, ...items];
    const sortedItems = sortExperienceEntries(nextItems);
    setItems(sortedItems);
    setEditingIndex(null);
    setDraft(null);
    onSave({ ...cv, experience: sortedItems });
  }

  function cancelExperience() {
    setEditingIndex(null);
    setDraft(null);
  }

  function removeExperience(index: number) {
    const nextItems = sortExperienceEntries(items.filter((_, itemIndex) => itemIndex !== index));
    setItems(nextItems);
    setRemoveIndex(null);
    if (editingIndex === index) cancelExperience();
    onSave({ ...cv, experience: nextItems });
  }

  function addPosition() {
    updateSelectedExperience({
      ...selectedExperience,
      positions: [makePosition(), ...selectedExperience.positions],
    });
  }

  function removePosition(positionIndex: number) {
    if (selectedExperience.positions.length === 1) return;
    updateSelectedExperience({
      ...selectedExperience,
      positions: selectedExperience.positions.filter((_, index) => index !== positionIndex),
    });
  }

  return (
    <EntryPanelList
      title="Experience"
      addLabel="Add"
      items={sortExperienceEntries(items)}
      editingIndex={editingIndex}
      removeIndex={removeIndex}
      onAdd={addExperience}
      onEdit={editExperience}
      onCancel={cancelExperience}
      onSave={saveExperience}
      onRemoveRequest={setRemoveIndex}
      onRemoveCancel={() => setRemoveIndex(null)}
      onRemoveConfirm={removeExperience}
      saveState={saveState}
      renderTitle={(experience) => experience.company || "Experience"}
      renderSubtitle={(experience) => {
        const position = sortPositionsByEnd(experience.positions)[0];
        return joinText([joinText(position?.roles ?? [], " / "), displayPeriodYear(position?.start ?? "", position?.end)]);
      }}
      renderEditor={() => (
        <>
          <Field
            label="Company"
            value={selectedExperience.company}
            onChange={(company) => updateSelectedExperience({ ...selectedExperience, company })}
          />
          <div className="entry-panel-section field-wide">
            <div className="entry-panel-heading">
              <h3>Positions</h3>
              <button type="button" className="secondary-button" onClick={addPosition}>
                Add
              </button>
            </div>
            <div className="entry-panel-list">
              {selectedExperience.positions.map((position, positionIndex) => (
                <section className="entry-panel" aria-label={positionPanelName(position)} key={position.id}>
                  <div className="entry-panel-summary">
                    <div>
                      <h3>{joinText(position.roles, " / ") || "Position"}</h3>
                      {hasText(displayPeriodYear(position.start, position.end)) && <p>{displayPeriodYear(position.start, position.end)}</p>}
                    </div>
                    <button
                      type="button"
                      className="danger-button"
                      onClick={() => removePosition(positionIndex)}
                      disabled={selectedExperience.positions.length === 1}
                    >
                      Remove
                    </button>
                  </div>
                  <div className="cv-form-grid">
                    <Textarea
                      label="Roles, one per line"
                      value={joinLines(position.roles)}
                      onChange={(roles) => updatePosition(positionIndex, { ...position, roles: splitLines(roles) })}
                      rows={3}
                    />
                    <div className="position-date-row field-wide">
                      <Field
                        label="Start"
                        type="date"
                        value={dateInputValue(position.start)}
                        onChange={(start) => updatePosition(positionIndex, { ...position, start })}
                      />
                      <CheckboxField
                        label="Current position"
                        checked={isCurrentPosition(position.end)}
                        onChange={(checked) => updatePosition(positionIndex, { ...position, end: checked ? "Present" : todayISODate() })}
                      />
                      <Field
                        label="End"
                        type="date"
                        value={dateInputValue(position.end ?? "")}
                        onChange={(end) => updatePosition(positionIndex, { ...position, end: end || undefined })}
                        hidden={isCurrentPosition(position.end)}
                        disabled={isCurrentPosition(position.end)}
                      />
                    </div>
                    <Field
                      label="Location"
                      value={position.location}
                      onChange={(location) => updatePosition(positionIndex, { ...position, location })}
                    />
                    <Textarea
                      label="Tasks and outcomes, one per line"
                      value={joinLines(position.tasks)}
                      onChange={(tasks) => updatePosition(positionIndex, { ...position, tasks: splitLines(tasks) })}
                      rows={6}
                    />
                  </div>
                </section>
              ))}
            </div>
          </div>
        </>
      )}
    />
  );
}

function EducationForm({ cv, saveState, onSave }: { cv: CV; saveState: SaveState; onSave: (cv: CV) => void }) {
  const [items, setItems] = useState<Education[]>(cv.education);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<Education | null>(null);
  const [removeIndex, setRemoveIndex] = useState<number | null>(null);
  useEffect(() => {
    setItems(sortEducationEntries(cv.education));
    setEditingIndex(null);
    setDraft(null);
  }, [cv.education]);

  const editingExisting = editingIndex !== null && editingIndex >= 0 && editingIndex < items.length;
  const currentDraft = draft ?? emptyEducation();

  function updateDraft(next: Education) {
    setDraft(next);
  }

  function saveEntry() {
    if (editingIndex === null || !draft) return;
    const nextItems = editingExisting
      ? items.map((item, index) => (index === editingIndex ? draft : item))
      : [draft, ...items];
    const sortedItems = sortEducationEntries(nextItems);
    setItems(sortedItems);
    setEditingIndex(null);
    setDraft(null);
    onSave({ ...cv, education: sortedItems });
  }

  function removeEntry(index: number) {
    const nextItems = sortEducationEntries(items.filter((_, itemIndex) => itemIndex !== index));
    setItems(nextItems);
    setRemoveIndex(null);
    setEditingIndex(null);
    setDraft(null);
    onSave({ ...cv, education: nextItems });
  }

  return (
    <EntryPanelList
      title="Education"
      addLabel="Add"
      items={sortEducationEntries(items)}
      editingIndex={editingIndex}
      removeIndex={removeIndex}
      onAdd={() => {
        setEditingIndex(-1);
        setDraft(emptyEducation());
      }}
      onEdit={(index) => {
        setEditingIndex(index);
        setDraft(items[index] ?? emptyEducation());
      }}
      onCancel={() => {
        setEditingIndex(null);
        setDraft(null);
      }}
      onSave={saveEntry}
      onRemoveRequest={setRemoveIndex}
      onRemoveCancel={() => setRemoveIndex(null)}
      onRemoveConfirm={removeEntry}
      saveState={saveState}
      renderTitle={(education) => education.name || "Education"}
      renderSubtitle={(education) => joinText([education.issuer, education.year > 0 ? String(education.year) : ""])}
      renderEditor={() => (
        <>
          <Field label="Qualification" value={currentDraft.name} onChange={(name) => updateDraft({ ...currentDraft, name })} />
          <Field label="Type" value={currentDraft.type ?? ""} onChange={(type) => updateDraft({ ...currentDraft, type })} />
          <Field label="Issuer" value={currentDraft.issuer} onChange={(issuer) => updateDraft({ ...currentDraft, issuer })} />
          <Field label="Year" type="number" value={currentDraft.year ? String(currentDraft.year) : ""} onChange={(year) => updateDraft({ ...currentDraft, year: Number(year) || 0 })} />
        </>
      )}
    />
  );
}

function SkillsForm({ cv, saveState, onSave }: { cv: CV; saveState: SaveState; onSave: (cv: CV) => void }) {
  const [skills, setSkills] = useState<string[]>(cv.skills?.length ? cv.skills : [""]);
  const [draggedSkillIndex, setDraggedSkillIndex] = useState<number | null>(null);
  useEffect(() => setSkills(cv.skills?.length ? cv.skills : [""]), [cv.skills]);

  function updateSkill(index: number, value: string) {
    setSkills((current) => current.map((skill, skillIndex) => (skillIndex === index ? value : skill)));
  }

  function removeSkill(index: number) {
    setSkills((current) => current.filter((_, skillIndex) => skillIndex !== index));
  }

  function reorderSkills(from: number | null, to: number) {
    if (from === null) return;
    setSkills((current) => moveItem(current, from, to));
  }

  return (
    <FormShell saveState={saveState} onSubmit={() => onSave({ ...cv, skills: skills.map((skill) => skill.trim()).filter(Boolean) })}>
      <div className="editable-list field-wide">
        {skills.map((skill, index) => (
          <div
            className="editable-list-row draggable-list-row"
            key={index}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => reorderSkills(draggedSkillIndex, index)}
          >
            <DragHandle
              label={`Move skill entry ${index + 1}`}
              onDragStart={(event) => {
                startDrag(event, index);
                setDraggedSkillIndex(index);
              }}
              onDragEnd={() => setDraggedSkillIndex(null)}
            />
            <Field label={`Skill ${index + 1}`} value={skill} onChange={(value) => updateSkill(index, value)} />
            <button type="button" className="secondary-button" onClick={() => removeSkill(index)} disabled={skills.length === 1}>
              Remove
            </button>
          </div>
        ))}
        <button type="button" className="secondary-button" onClick={() => setSkills((current) => ["", ...current])}>
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

function CertificationsForm({ cv, saveState, onSave }: { cv: CV; saveState: SaveState; onSave: (cv: CV) => void }) {
  const [items, setItems] = useState<Certification[]>(cv.certifications);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<Certification | null>(null);
  const [removeIndex, setRemoveIndex] = useState<number | null>(null);
  useEffect(() => {
    setItems(sortCertificationEntries(cv.certifications));
    setEditingIndex(null);
    setDraft(null);
  }, [cv.certifications]);

  const editingExisting = editingIndex !== null && editingIndex >= 0 && editingIndex < items.length;
  const currentDraft = draft ?? emptyCertification();

  function updateDraft(next: Certification) {
    setDraft(next);
  }

  function saveEntry() {
    if (editingIndex === null || !draft) return;
    const nextItems = editingExisting
      ? items.map((item, index) => (index === editingIndex ? draft : item))
      : [draft, ...items];
    const sortedItems = sortCertificationEntries(nextItems);
    setItems(sortedItems);
    setEditingIndex(null);
    setDraft(null);
    onSave({ ...cv, certifications: sortedItems });
  }

  function removeEntry(index: number) {
    const nextItems = sortCertificationEntries(items.filter((_, itemIndex) => itemIndex !== index));
    setItems(nextItems);
    setRemoveIndex(null);
    setEditingIndex(null);
    setDraft(null);
    onSave({ ...cv, certifications: nextItems });
  }

  return (
    <EntryPanelList
      title="Certifications"
      addLabel="Add"
      items={sortCertificationEntries(items)}
      editingIndex={editingIndex}
      removeIndex={removeIndex}
      onAdd={() => {
        setEditingIndex(-1);
        setDraft(emptyCertification());
      }}
      onEdit={(index) => {
        setEditingIndex(index);
        setDraft(items[index] ?? emptyCertification());
      }}
      onCancel={() => {
        setEditingIndex(null);
        setDraft(null);
      }}
      onSave={saveEntry}
      onRemoveRequest={setRemoveIndex}
      onRemoveCancel={() => setRemoveIndex(null)}
      onRemoveConfirm={removeEntry}
      saveState={saveState}
      renderTitle={(certification) => certification.name || "Certification"}
      renderSubtitle={(certification) => joinText([certification.issuer, certification.year > 0 ? String(certification.year) : ""])}
      renderEditor={() => (
        <>
          <Field label="Certification" value={currentDraft.name} onChange={(name) => updateDraft({ ...currentDraft, name })} />
          <Field label="Credential ID" value={currentDraft.id} onChange={(id) => updateDraft({ ...currentDraft, id })} />
          <Field label="Issuer" value={currentDraft.issuer} onChange={(issuer) => updateDraft({ ...currentDraft, issuer })} />
          <Field label="Year" type="number" value={currentDraft.year ? String(currentDraft.year) : ""} onChange={(year) => updateDraft({ ...currentDraft, year: Number(year) || 0 })} />
        </>
      )}
    />
  );
}

function LanguagesForm({ cv, saveState, onSave }: { cv: CV; saveState: SaveState; onSave: (cv: CV) => void }) {
  const [items, setItems] = useState<Language[]>(cv.languages);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<Language | null>(null);
  const [removeIndex, setRemoveIndex] = useState<number | null>(null);
  useEffect(() => {
    setItems(cv.languages);
    setEditingIndex(null);
    setDraft(null);
  }, [cv.languages]);

  const editingExisting = editingIndex !== null && editingIndex >= 0 && editingIndex < items.length;
  const currentDraft = draft ?? emptyLanguage();

  function updateDraft(next: Language) {
    setDraft(next);
  }

  function saveEntry() {
    if (editingIndex === null || !draft) return;
    const nextItems = editingExisting
      ? items.map((item, index) => (index === editingIndex ? draft : item))
      : [draft, ...items];
    setItems(nextItems);
    setEditingIndex(null);
    setDraft(null);
    onSave({ ...cv, languages: nextItems });
  }

  function removeEntry(index: number) {
    const nextItems = items.filter((_, itemIndex) => itemIndex !== index);
    setItems(nextItems);
    setRemoveIndex(null);
    setEditingIndex(null);
    setDraft(null);
    onSave({ ...cv, languages: nextItems });
  }

  function moveEntry(from: number, to: number) {
    const nextItems = moveItem(items, from, to);
    setItems(nextItems);
    onSave({ ...cv, languages: nextItems });
  }

  return (
    <EntryPanelList
      title="Languages"
      addLabel="Add"
      items={items}
      editingIndex={editingIndex}
      removeIndex={removeIndex}
      dragLabel="language"
      onMove={moveEntry}
      onAdd={() => {
        setEditingIndex(-1);
        setDraft(emptyLanguage());
      }}
      onEdit={(index) => {
        setEditingIndex(index);
        setDraft(items[index] ?? emptyLanguage());
      }}
      onCancel={() => {
        setEditingIndex(null);
        setDraft(null);
      }}
      onSave={saveEntry}
      onRemoveRequest={setRemoveIndex}
      onRemoveCancel={() => setRemoveIndex(null)}
      onRemoveConfirm={removeEntry}
      saveState={saveState}
      renderTitle={(language) => language.name || "Language"}
      renderSubtitle={(language) => language.level}
      renderEditor={() => (
        <>
          <Field label="Language" value={currentDraft.name} onChange={(name) => updateDraft({ ...currentDraft, name })} />
          <Field label="Level" value={currentDraft.level} onChange={(level) => updateDraft({ ...currentDraft, level })} />
        </>
      )}
    />
  );
}

function PreferencesForm({
  preferences,
  saveState,
  onSave,
}: {
  preferences: string;
  saveState: SaveState;
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
    <div className="field field-wide" data-save-status={saveState.status}>
      <label htmlFor="candidate-preferences">Preferences and constraints</label>
      <textarea
        id="candidate-preferences"
        name="candidate-preferences"
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
      <span className="preference-footer">
        <span className={saveState.status === "error" ? "save-inline-message save-inline-error" : "save-inline-message"} role="status">
          {preferenceSaveLabel(saveState)}
        </span>
        <span className={count > 1800 ? "preference-count preference-count-warning" : "preference-count"}>
          {count}/2000
        </span>
      </span>
    </div>
  );
}

function preferenceSaveLabel(saveState: SaveState) {
  if (saveState.status === "saving") return "Saving";
  if (saveState.status === "error") return saveState.message ?? "Could not save preferences.";
  return "";
}

function EntryPanelList<T>({
  title,
  addLabel,
  items,
  editingIndex,
  removeIndex,
  saveState,
  onAdd,
  onEdit,
  onCancel,
  onSave,
  onRemoveRequest,
  onRemoveCancel,
  onRemoveConfirm,
  dragLabel,
  onMove,
  renderTitle,
  renderSubtitle,
  renderEditor,
}: {
  title: string;
  addLabel: string;
  items: T[];
  editingIndex: number | null;
  removeIndex: number | null;
  saveState: SaveState;
  onAdd: () => void;
  onEdit: (index: number) => void;
  onCancel: () => void;
  onSave: () => void;
  onRemoveRequest: (index: number) => void;
  onRemoveCancel: () => void;
  onRemoveConfirm: (index: number) => void;
  dragLabel?: string;
  onMove?: (from: number, to: number) => void;
  renderTitle: (entry: T) => string;
  renderSubtitle: (entry: T) => string;
  renderEditor: () => ReactNode;
}) {
  const adding = editingIndex === -1 || editingIndex === items.length;
  const addingAtTop = editingIndex === -1;
  const panelCount = adding ? items.length + 1 : items.length;
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const canMove = Boolean(onMove) && editingIndex === null;

  return (
    <div className="entry-panel-section">
      <div className="entry-panel-heading">
        <h2>{title}</h2>
        <button type="button" className="secondary-button" onClick={onAdd} disabled={editingIndex !== null}>
          {addLabel}
        </button>
      </div>

      {panelCount === 0 ? (
        <p className="muted">No entries yet.</p>
      ) : (
        <div className="entry-panel-list">
          {Array.from({ length: panelCount }, (_, index) => {
            const itemIndex = addingAtTop ? index - 1 : index;
            const item = itemIndex >= 0 ? items[itemIndex] : undefined;
            const isEditing = addingAtTop ? index === 0 : editingIndex === index;
            const panelTitle = item ? renderTitle(item) : `New ${title.toLowerCase()} entry`;
            const panelSubtitle = item ? renderSubtitle(item) : "";
            const accessibleName = joinText([panelTitle, panelSubtitle], " ");
            const isMovable = canMove && Boolean(item);

            return (
              <section
                className="entry-panel"
                aria-label={accessibleName}
                key={index}
                onDragOver={isMovable ? (event) => event.preventDefault() : undefined}
                onDrop={isMovable ? () => {
                  if (draggedIndex !== null && itemIndex >= 0) onMove?.(draggedIndex, itemIndex);
                } : undefined}
              >
                <div className={isMovable ? "entry-panel-summary entry-panel-summary-draggable" : "entry-panel-summary"}>
                  {isMovable && (
                    <DragHandle
                      label={`Move ${dragLabel ?? title.toLowerCase()} entry ${index + 1}`}
                      onDragStart={(event) => {
                        startDrag(event, itemIndex);
                        setDraggedIndex(itemIndex);
                      }}
                      onDragEnd={() => setDraggedIndex(null)}
                    />
                  )}
                  <div>
                    <h3>{panelTitle}</h3>
                    {hasText(panelSubtitle) && <p>{panelSubtitle}</p>}
                  </div>
                  {!isEditing && (
                    <div className="entry-panel-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => onEdit(itemIndex)}
                        disabled={editingIndex !== null}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="danger-button"
                        onClick={() => onRemoveRequest(itemIndex)}
                        disabled={editingIndex !== null}
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>
                {isEditing && (
                  <form
                    className="entry-panel-editor"
                    onSubmit={(event: FormEvent) => {
                      event.preventDefault();
                      onSave();
                    }}
                  >
                    <div className="cv-form-grid">{renderEditor()}</div>
                    <div className="entry-panel-edit-actions">
                      <button type="submit" className="primary-rect-button">
                        {saveButtonLabel(saveState, "Save")}
                      </button>
                      {saveState.status === "error" && saveState.message && (
                        <span className="save-inline-message" role="status">
                          {saveState.message}
                        </span>
                      )}
                      <button type="button" className="secondary-button" onClick={onCancel}>
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </section>
            );
          })}
        </div>
      )}

      {removeIndex !== null && (
        <ConfirmRemoveDialog
          title={`Remove ${title.toLowerCase()} entry?`}
          onCancel={onRemoveCancel}
          onConfirm={() => onRemoveConfirm(removeIndex)}
        />
      )}
    </div>
  );
}

function DragHandle({
  label,
  onDragStart,
  onDragEnd,
}: {
  label: string;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
}) {
  return (
    <button
      type="button"
      className="drag-handle"
      aria-label={label}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <span aria-hidden="true">::</span>
    </button>
  );
}

function startDrag(event: DragEvent<HTMLElement>, index: number) {
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", String(index));
}

function ConfirmRemoveDialog({
  title,
  onCancel,
  onConfirm,
}: {
  title: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="remove-entry-title">
        <h2 id="remove-entry-title">{title}</h2>
        <p className="muted">This entry will be removed from your CV.</p>
        <div className="modal-actions">
          <button type="button" className="danger-button" onClick={onConfirm}>
            Remove
          </button>
          <button type="button" className="secondary-button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function FormShell({ children, saveState, onSubmit }: { children: ReactNode; saveState: SaveState; onSubmit: () => void }) {
  return (
    <form
      className="cv-form"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="cv-form-grid">{children}</div>
      <div className="form-save-row">
        <button type="submit" className="primary-rect-button" disabled={saveState.status === "saving"}>
          {saveButtonLabel(saveState, "Save section")}
        </button>
        {saveState.status === "error" && saveState.message && (
          <span className="save-inline-message" role="status">
            {saveState.message}
          </span>
        )}
      </div>
    </form>
  );
}

function saveButtonLabel(saveState: SaveState, idleLabel: string) {
  if (saveState.status === "saving") return "Saving";
  return idleLabel;
}

function joinText(parts: Array<string | undefined>, separator = " | ") {
  return parts.filter(hasText).join(separator);
}

function formatCVValidationErrors(cv: CV, errors: string[]) {
  return errors.map((error) => formatCVValidationError(cv, error));
}

function formatCVValidationError(cv: CV, error: string) {
  if (error.includes("cv.summary")) return "Summary";
  if (error.includes("contact.name")) return "First name";
  if (error.includes("contact.surname")) return "Surname";
  if (error.includes("contact.email")) return "Email";
  if (error.includes("contact.linkedin") || error.includes("contact.github") || error.includes("contact.www") || error.includes("contact.links")) return "Links";
  if (error.includes("phone.prefix")) return "Phone prefix";
  if (error.includes("phone.number")) return "Phone number";
  if (error.includes("cv.languages")) return "Languages";
  if (error.includes("cv.education")) return "Education";
  if (error.includes("cv.experience must contain")) return "Experience";

  const certificationMatch = error.match(/cv\.certifications\[(\d+)\].*certification\.(\w+)/);
  if (certificationMatch) {
    const certification = cv.certifications[Number(certificationMatch[1])];
    const field = certificationMatch[2] === "issuer" ? "Provider" : humaniseField(certificationMatch[2]);
    return joinText([field, certification?.name ? `for ${certification.name}` : "for certification"]);
  }

  const educationMatch = error.match(/cv\.education\[(\d+)\].*education\.(\w+)/);
  if (educationMatch) {
    const education = cv.education[Number(educationMatch[1])];
    const field = educationMatch[2] === "issuer" ? "Institution" : humaniseField(educationMatch[2]);
    return joinText([field, education?.name ? `for ${education.name}` : "for education"]);
  }

  const experienceMatch = error.match(/cv\.experience\[(\d+)\].*experience\.positions\[(\d+)\].*cv_position\.(\w+)/);
  if (experienceMatch) {
    const experience = cv.experience[Number(experienceMatch[1])];
    const position = experience?.positions[Number(experienceMatch[2])];
    const role = joinText(position?.roles ?? [], " / ") || "position";
    const company = experience?.company || "company";
    return positionFieldError(experienceMatch[3], company, role);
  }

  const experienceEntryMatch = error.match(/cv\.experience\[(\d+)\].*experience\.(\w+)/);
  if (experienceEntryMatch) {
    const experience = cv.experience[Number(experienceEntryMatch[1])];
    return joinText([humaniseField(experienceEntryMatch[2]), experience?.company ? `for ${experience.company}` : "for experience"]);
  }

  return sentenceField(error.split(" is required")[0].split(" must contain")[0].split(".").pop() ?? error);
}

function humaniseField(value: string) {
  if (value === "roles") return "role";
  if (value === "tasks") return "tasks and outcomes";
  return value
    .replace(/^cv_/, "")
    .replace(/_/g, " ")
    .toLowerCase();
}

function sentenceField(value: string) {
  const field = humaniseField(value);
  return field.charAt(0).toUpperCase() + field.slice(1);
}

function positionFieldError(field: string, company: string, role: string) {
  return (
    <>
      {humaniseField(field)} for <strong>{role}</strong> at {company}
    </>
  );
}

function sortExperienceEntries(items: Experience[]) {
  return [...items]
    .map((item) => ({ ...item, positions: sortPositionsByEnd(item.positions) }))
    .sort(compareExperienceRecency);
}

function sortPositionsByEnd(items: CVPosition[]) {
  return [...items].sort(comparePositionRecency);
}

function sortEducationEntries(items: Education[]) {
  return [...items].sort((a, b) => yearRank(b.year) - yearRank(a.year));
}

function sortCertificationEntries(items: Certification[]) {
  return [...items].sort((a, b) => yearRank(b.year) - yearRank(a.year));
}

function compareExperienceRecency(a: Experience, b: Experience) {
  return comparePositionRecency(a.positions[0] ?? makePosition(), b.positions[0] ?? makePosition());
}

function comparePositionRecency(a: CVPosition, b: CVPosition) {
  const aCurrent = isCurrentPosition(a.end);
  const bCurrent = isCurrentPosition(b.end);
  if (aCurrent !== bCurrent) return aCurrent ? -1 : 1;

  const primary = aCurrent
    ? dateRank(b.start) - dateRank(a.start)
    : dateRank(b.end) - dateRank(a.end);
  if (primary !== 0) return primary;

  return dateRank(b.start) - dateRank(a.start);
}

function dateRank(value?: string) {
  if (!hasText(value)) return 0;
  const year = Number.parseInt(value.slice(0, 4), 10);
  const month = Number.parseInt(value.slice(5, 7), 10) || 1;
  const day = Number.parseInt(value.slice(8, 10), 10) || 1;
  return Number.isFinite(year) ? year * 372 + month * 31 + day : 0;
}

function yearRank(value: number) {
  return value > 0 ? value : Number.MIN_SAFE_INTEGER;
}

function moveItem<T>(items: T[], from: number, to: number) {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function displayPeriod(start: string, end?: string) {
  if (hasText(start) && isCurrentPosition(end)) return `${start} - Present`;
  return joinText([start, end], " - ");
}

function displayPeriodYear(start: string, end?: string) {
  const startYear = /^(\d{4})/.exec(start)?.[1];
  if (!startYear) return "";
  if (isCurrentPosition(end)) return `Since ${startYear}`;
  const endYear = /^(\d{4})/.exec(end ?? "")?.[1];
  return endYear && endYear !== startYear ? `${startYear} – ${endYear}` : startYear;
}

function positionPanelName(position: CVPosition) {
  return joinText([joinText(position.roles, " / ") || "Position", displayPeriod(position.start, position.end)], " ");
}

function isCurrentPosition(value?: string) {
  return !hasText(value) || /present|current|now/i.test(value);
}

function dateInputValue(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

function normaliseExperienceList(experience: Experience[]) {
  return experience.map((item) => ({
    ...item,
    positions: item.positions.length ? item.positions : [makePosition()],
  }));
}

function Field({
  label,
  accessibleLabel,
  name,
  value,
  onChange,
  type = "text",
  placeholder,
  disabled = false,
  hidden = false,
}: {
  label: string;
  accessibleLabel?: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
  hidden?: boolean;
}) {
  const generatedId = useId();
  const inputId = name ?? generatedId;

  return (
    <div className="field" hidden={hidden} style={hidden ? { display: "none" } : undefined}>
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        name={name ?? inputId}
        type={type}
        value={value}
        placeholder={placeholder}
        aria-label={accessibleLabel}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const generatedId = useId();

  return (
    <div className="checkbox-field">
      <input
        id={generatedId}
        name={generatedId}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <label htmlFor={generatedId}>{label}</label>
    </div>
  );
}

function Textarea({
  label,
  name,
  value,
  onChange,
  rows,
}: {
  label: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  rows: number;
}) {
  const generatedId = useId();
  const textareaId = name ?? generatedId;

  return (
    <div className="field field-wide">
      <label htmlFor={textareaId}>{label}</label>
      <textarea
        id={textareaId}
        name={name ?? textareaId}
        value={value}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
