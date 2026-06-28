import type { CV, CVPosition, CVProjectItem, Certification, Education, Experience } from "@/lib/types";
import {
  hasCertificationContent,
  hasEducationContent,
  hasExperienceContent,
  hasLanguageContent,
  hasText,
} from "@/lib/cv";

export type CVPrintTemplate = "default" | "ats";

export const printTemplates: { id: CVPrintTemplate; label: string }[] = [
  { id: "default", label: "Default" },
  { id: "ats", label: "ATS" },
];

interface PrintData {
  name: string;
  email: string;
  phone: string;
  links: string[];
  experience: Experience[];
  education: Education[];
  skills: string[];
  certifications: Certification[];
  languages: CV["languages"];
  projects: CVProjectItem[];
  projectUrl: string;
}

export function DefaultCVPrintTemplate({ cv }: { cv: CV }) {
  const data = getPrintData(cv);

  return (
    <article className="cv-default-document" aria-label="Printable CV default">
      <header className="cv-default-header">
        <h1>{data.name}</h1>
        <div className="cv-default-contact">
          <p className="cv-default-contact-primary">
            {hasText(data.email) && <a href={`mailto:${data.email}`}>{data.email}</a>}
            {hasText(data.phone) && <a href={`tel:${phoneHref(data.phone)}`}>{data.phone}</a>}
          </p>
          {data.links.length > 0 && (
            <p className="cv-default-contact-links">
              {data.links.map((link) => (
                <a href={link} key={link}>
                  {displayUrl(link)}
                </a>
              ))}
            </p>
          )}
        </div>
      </header>

      <section className="cv-default-section summary">
        <h2 className="cv-default-visually-hidden">Summary</h2>
        {hasText(cv.summary) && <p>{cv.summary}</p>}
      </section>

      {data.experience.length > 0 && (
        <section className="cv-default-section">
          <h2>Experience</h2>
          {data.experience.map((item, index) =>
            item.positions.map((position, positionIndex) => (
              <section
                className="cv-default-entry"
                key={`${item.company}-${position.id}-${index}-${positionIndex}`}
              >
                <header className="cv-default-entry-header">
                  <div>
                    {hasText(item.company) && <h3>{item.company}</h3>}
                    {joinText(position.roles, " | ") && <p>{joinText(position.roles, " | ")}</p>}
                  </div>
                  {displayPeriod(position.start, position.end) && (
                    <p className="cv-default-entry-period">{displayPeriod(position.start, position.end)}</p>
                  )}
                  {hasText(position.location) && (
                    <p className="cv-default-entry-location">{position.location}</p>
                  )}
                </header>
                {position.tasks.filter(hasText).length > 0 && (
                  <ul>
                    {position.tasks.filter(hasText).map((task) => (
                      <li key={task}>{task}</li>
                    ))}
                  </ul>
                )}
              </section>
            )),
          )}
        </section>
      )}

      {data.education.length > 0 && (
        <section className="cv-default-section">
          <h2>Education</h2>
          {data.education.map((item, index) => (
            <section className="cv-default-entry" key={`${item.name}-${item.issuer}-${index}`}>
              <header className="cv-default-entry-header">
                <div>
                  <h3>{joinText([item.name, item.type], ", ")}</h3>
                  <p>{item.issuer}</p>
                </div>
                {item.year > 0 && <p className="cv-default-entry-period">{item.year}</p>}
              </header>
            </section>
          ))}
        </section>
      )}

      {data.skills.length > 0 && (
        <section className="cv-default-section">
          <h2>Skills</h2>
          <p>{data.skills.join(", ")}</p>
        </section>
      )}

      {data.certifications.length > 0 && (
        <section className="cv-default-section">
          <h2>Certifications</h2>
          <dl className="cv-default-definition-list">
            {data.certifications.map((item, index) => (
              <DefinitionItem
                title={item.name}
                body={joinText([item.issuer, item.id, item.year > 0 ? String(item.year) : ""], ", ")}
                key={`${item.name}-${item.id}-${index}`}
              />
            ))}
          </dl>
        </section>
      )}

      {data.languages.length > 0 && (
        <section className="cv-default-section">
          <h2>Languages</h2>
          <dl className="cv-default-definition-list cv-default-definition-list-compact">
            {data.languages.map((item, index) => (
              <DefinitionItem title={item.name} body={item.level} key={`${item.name}-${index}`} />
            ))}
          </dl>
        </section>
      )}

      {(data.projects.length > 0 || hasText(data.projectUrl)) && (
        <section className="cv-default-section">
          <h2>Projects</h2>
          <dl className="cv-default-definition-list">
            {data.projects.map((item, index) => (
              <DefinitionItem
                title={item.name}
                body={joinText([item.summary, item.description, item.url], ", ")}
                key={`${item.name}-${index}`}
              />
            ))}
            {hasText(data.projectUrl) && <DefinitionItem title="More projects" body={data.projectUrl} />}
          </dl>
        </section>
      )}

      <CVAIPrintBrand className="cv-default" />
    </article>
  );
}

export function ATSCVPrintTemplate({ cv }: { cv: CV }) {
  const data = getPrintData(cv);

  return (
    <article className="cv-ats-document" aria-label="Printable CV ATS">
      <header className="cv-ats-header">
        <h1>{data.name}</h1>
        <p>{joinText([data.email, data.phone, ...data.links.map(displayUrl)], " | ")}</p>
      </header>

      {hasText(cv.summary) && (
        <section className="cv-ats-section">
          <h2>Summary</h2>
          <p>{cv.summary}</p>
        </section>
      )}

      {data.experience.length > 0 && (
        <section className="cv-ats-section">
          <h2>Experience</h2>
          {data.experience.map((item, index) =>
            item.positions.map((position, positionIndex) => (
              <section className="cv-ats-entry" key={`${item.company}-${position.id}-${index}-${positionIndex}`}>
                <h3>{joinText([item.company, joinText(position.roles, " / ")], " - ")}</h3>
                <p>{joinText([displayPeriod(position.start, position.end), position.location], " | ")}</p>
                {position.tasks.filter(hasText).length > 0 && (
                  <ul>
                    {position.tasks.filter(hasText).map((task) => (
                      <li key={task}>{task}</li>
                    ))}
                  </ul>
                )}
              </section>
            )),
          )}
        </section>
      )}

      {data.education.length > 0 && (
        <section className="cv-ats-section">
          <h2>Education</h2>
          {data.education.map((item, index) => (
            <section className="cv-ats-entry" key={`${item.name}-${item.issuer}-${index}`}>
              <h3>{joinText([item.name, item.type], ", ")}</h3>
              <p>{joinText([item.issuer, item.year > 0 ? String(item.year) : ""], " | ")}</p>
            </section>
          ))}
        </section>
      )}

      {data.skills.length > 0 && (
        <section className="cv-ats-section">
          <h2>Skills</h2>
          <p>{data.skills.join(", ")}</p>
        </section>
      )}

      {data.certifications.length > 0 && (
        <section className="cv-ats-section">
          <h2>Certifications</h2>
          {data.certifications.map((item, index) => (
            <section className="cv-ats-entry" key={`${item.name}-${item.id}-${index}`}>
              <p>{joinText([item.name, item.issuer, item.id, item.year > 0 ? String(item.year) : ""], " | ")}</p>
            </section>
          ))}
        </section>
      )}

      {data.languages.length > 0 && (
        <section className="cv-ats-section">
          <h2>Languages</h2>
          <p>{data.languages.map((item) => joinText([item.name, item.level], ", ")).join("; ")}</p>
        </section>
      )}

      {(data.projects.length > 0 || hasText(data.projectUrl)) && (
        <section className="cv-ats-section">
          <h2>Projects</h2>
          {data.projects.map((item, index) => (
            <section className="cv-ats-entry" key={`${item.name}-${index}`}>
              <h3>{item.name}</h3>
              <p>{joinText([item.summary, item.description, item.url], " | ")}</p>
            </section>
          ))}
          {hasText(data.projectUrl) && <p>{data.projectUrl}</p>}
        </section>
      )}
    </article>
  );
}

function DefinitionItem({ title, body }: { title: string; body: string }) {
  return (
    <>
      <dt>{title}</dt>
      <dd>{body}</dd>
    </>
  );
}

function CVAIPrintBrand({ className }: { className: string }) {
  return (
    <div className={`${className}-brand-note`} aria-label="Built by CVirgil">
      <svg className={`${className}-brand-logo`} viewBox="0 0 77.942 160" aria-hidden="true">
        <g transform="translate(-167.89 -14.169)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.0337">
          <path d="m185.21 49.169 8e-4 60 51.961-30.001-17.32-9.9998-17.321 10.001-5e-4 -8.66e-4 6.7e-4 -20z" />
          <path d="m245.83 114.17-3.8e-4 30-3.9e-4 30-17.32-9.9999 7.2e-4 -20-6.8e-4 -20z" />
          <path d="m211.19 34.169-17.32 10.001 51.961 29.999-7.5e-4 -60-17.32 9.9999 7.2e-4 20 5e-4 8.66e-4 -1e-3 -4.01e-4z" />
          <path d="m219.85 99.169-51.961 29.999 17.321 10.001 17.32-10.001-7.3e-4 20 17.32 9.9999z" />
          <path d="m245.83 84.169-17.32 10v20l17.32-10z" />
        </g>
      </svg>
      <div>
        <p>
          <strong>
            Made with <span>CVAI</span>
          </strong>
        </p>
        <p>
          <a href="https://cvirgil.com/">https://cvirgil.com/</a>
        </p>
      </div>
    </div>
  );
}

function getPrintData(cv: CV): PrintData {
  return {
    name: joinText([cv.contact.name, cv.contact.surname], " ") || "CV",
    email: cv.contact.email,
    phone: joinText(
      [
        cv.contact.phone.prefix ? `+${cv.contact.phone.prefix.replace(/^\+/, "")}` : "",
        cv.contact.phone.number,
      ],
      " ",
    ),
    links: cv.contact.links.map((link) => link.url).filter(hasText),
    experience: sortExperienceEntries(cv.experience.filter(hasExperienceContent)),
    education: [...cv.education].filter(hasEducationContent).sort((a, b) => compareYear(a, b)),
    skills: cv.skills?.filter(hasText) ?? [],
    certifications: [...cv.certifications]
      .filter(hasCertificationContent)
      .sort((a, b) => compareYear(a, b)),
    languages: [...cv.languages].filter(hasLanguageContent),
    projects: [...cv.projects.items].filter(hasProjectContent),
    projectUrl: cv.projects.url ?? "",
  };
}

function joinText(parts: Array<string | undefined>, separator = " ") {
  return parts.map((part) => part?.trim() ?? "").filter(Boolean).join(separator);
}

function displayPeriod(start: string, end?: string) {
  if (hasText(start) && isCurrentPosition(end)) return `${start} - Present`;
  return joinText([start, end], " - ");
}

function phoneHref(phone: string) {
  return phone.replace(/[^\d+]/g, "");
}

function displayUrl(url: string) {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function hasProjectContent(project: CVProjectItem) {
  return (
    project.visible !== false &&
    [project.name, project.summary, project.description, project.url].some(hasText)
  );
}

function sortExperienceEntries(items: Experience[]) {
  return [...items]
    .map((item) => ({ ...item, positions: [...item.positions].sort(comparePositionRecency) }))
    .sort(compareExperienceRecency);
}

function compareExperienceRecency(a: Experience, b: Experience) {
  return comparePositionRecency(a.positions[0] ?? emptyPosition(), b.positions[0] ?? emptyPosition());
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

function isCurrentPosition(value?: string) {
  return !hasText(value) || /present|current|now/i.test(value);
}

function emptyPosition(): CVPosition {
  return {
    id: "",
    roles: [],
    start: "",
    end: "",
    location: "",
    tasks: [],
  };
}

function compareYear(a: Education | Certification, b: Education | Certification) {
  const left = a.year > 0 ? a.year : Number.MAX_SAFE_INTEGER;
  const right = b.year > 0 ? b.year : Number.MAX_SAFE_INTEGER;
  return left - right;
}
