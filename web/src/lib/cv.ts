import type {
  CV,
  CVPosition,
  Candidate,
  Certification,
  Education,
  Experience,
  Link,
  Language,
} from "@/lib/types";

export const emptyCV: CV = {
  summary: "",
  contact: {
    name: "",
    surname: "",
    phone: { prefix: "", number: "" },
    email: "",
    links: [],
  },
  skills: [],
  languages: [],
  certifications: [],
  education: [],
  experience: [],
  projects: {
    url: "",
    items: [],
  },
};

export const emptyCandidateContext = {
  version: 1,
  constraints: {},
  preferences: {},
};

export function normaliseCV(candidate?: Partial<Candidate> | null): CV {
  const cv = candidate?.cv;
  const contact = {
    ...emptyCV.contact,
    ...cv?.contact,
    phone: {
      ...emptyCV.contact.phone,
      ...cv?.contact?.phone,
    },
  };
  // TODO(before GA M3): remove this legacy social-field bridge once all saved CVs use contact.links[].
  const legacyLinks = [
    { label: "LinkedIn", url: contact.linkedin ?? "" },
    { label: "GitHub", url: contact.github ?? "" },
    { label: "Website", url: contact.www ?? "" },
  ].filter((link) => hasText(link.url));

  return {
    ...emptyCV,
    ...cv,
    contact: {
      ...contact,
      links: contact.links?.length ? contact.links : legacyLinks,
    },
    languages: cv?.languages ?? [],
    skills: cv?.skills ?? [],
    certifications: cv?.certifications ?? [],
    education: cv?.education ?? [],
    experience: normaliseExperienceDates(cv?.experience ?? []),
    projects: {
      ...emptyCV.projects,
      ...cv?.projects,
      items: cv?.projects?.items ?? [],
    },
  };
}

export function hasCVContent(cv: CV): boolean {
  return (
    hasContactContent(cv) ||
    hasText(cv.summary) ||
    cv.experience.some(hasExperienceContent) ||
    cv.education.some(hasEducationContent) ||
    (cv.skills ?? []).length > 0 ||
    cv.certifications.some(hasCertificationContent) ||
    cv.languages.some(hasLanguageContent) ||
    hasText(cv.projects.url) ||
    cv.projects.items.some((item) =>
      [item.name, item.summary, item.url, item.description].some(hasText),
    )
  );
}

export function getCVCompleteness(cv: CV) {
  const checks = [
    { label: "Name", complete: hasText(cv.contact.name) || hasText(cv.contact.surname) },
    {
      label: "Contact",
      complete:
        hasText(cv.contact.email) ||
        hasText(cv.contact.phone.number) ||
        cv.contact.links.some((link) => hasText(link.url)),
    },
    { label: "Summary", complete: hasText(cv.summary) },
    { label: "Experience", complete: cv.experience.some(hasExperienceContent) },
    { label: "Education", complete: cv.education.some(hasEducationContent) },
    { label: "Skills", complete: (cv.skills ?? []).length > 0 },
    {
      label: "Certifications",
      complete: cv.certifications.some(hasCertificationContent),
    },
    { label: "Languages", complete: cv.languages.some(hasLanguageContent) },
  ];

  const complete = checks.filter((check) => check.complete).length;
  return {
    complete,
    total: checks.length,
    percent: Math.round((complete / checks.length) * 100),
    checks,
  };
}

export function splitLines(value: string): string[] {
  return value.split("\n");
}

export function joinLines(value?: string[]): string {
  return (value ?? []).join("\n");
}

export function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function hasContactContent(cv: CV): boolean {
  return [
    cv.contact.name,
    cv.contact.surname,
    cv.contact.email,
    ...cv.contact.links.flatMap((link) => [link.label, link.url]),
    cv.contact.phone.prefix,
    cv.contact.phone.number,
  ].some(hasText);
}

export function hasExperienceContent(experience: Experience): boolean {
  return (
    hasText(experience.company) ||
    experience.positions.some((position) =>
      [
        ...position.roles,
        position.start,
        position.end,
        position.location,
        ...position.tasks,
        ...(position.keywords ?? []),
      ].some(hasText),
    )
  );
}

export function hasEducationContent(education: Education): boolean {
  return (
    hasText(education.name) ||
    hasText(education.issuer) ||
    hasText(education.type) ||
    education.year > 0
  );
}

export function hasCertificationContent(certification: Certification): boolean {
  return (
    hasText(certification.name) ||
    hasText(certification.id) ||
    hasText(certification.issuer) ||
    certification.year > 0
  );
}

export function hasLanguageContent(language: Language): boolean {
  return hasText(language.name) || hasText(language.level);
}

export function makeExperience(company = ""): Experience {
  return {
    company,
    positions: [makePosition()],
  };
}

export function makePosition(): CVPosition {
  return {
    id: crypto.randomUUID(),
    roles: [],
    start: "",
    end: new Date().toISOString().slice(0, 10),
    location: "",
    tasks: [],
  };
}

function normaliseExperienceDates(experience: Experience[]): Experience[] {
  return experience.map((item) => ({
    ...item,
    positions: item.positions.map((position) => {
      const end = normalisePartialDate(position.end);
      return {
        ...position,
        start: normalisePartialDate(position.start) ?? "",
        ...(end ? { end } : {}),
      };
    }),
  }));
}

function normalisePartialDate(value?: string) {
  if (!hasText(value)) return undefined;
  const trimmed = value.trim();
  if (/present|current|now/i.test(trimmed)) return "Present";

  const year = trimmed.match(/^(\d{4})$/);
  if (year) return `${year[1]}-01-01`;

  const yearMonth = trimmed.match(/^(\d{4})-(\d{1,2})$/);
  if (yearMonth) return `${yearMonth[1]}-${yearMonth[2].padStart(2, "0")}-01`;

  return trimmed;
}

export function validateCV(cv: CV): string[] {
  return [
    ...required("cv.summary", cv.summary),
    ...validateContact(cv.contact),
    ...minLen("cv.languages", cv.languages.length, 1),
    ...validateSlice("cv.languages", cv.languages, validateLanguage),
    ...validateSlice("cv.certifications", cv.certifications, validateCertification),
    ...validateSlice("cv.education", cv.education, validateEducation),
    ...minLen("cv.experience", cv.experience.length, 1),
    ...validateSlice("cv.experience", cv.experience, validateExperience),
    ...validateProjects(cv.projects),
  ];
}

function validateContact(contact: CV["contact"]): string[] {
  return [
    ...required("contact.name", contact.name),
    ...required("contact.surname", contact.surname),
    ...required("phone.prefix", contact.phone.prefix),
    ...required("phone.number", contact.phone.number),
    ...required("contact.email", contact.email),
    ...validateSlice("contact.links", contact.links, validateLink),
  ];
}

function validateLanguage(language: Language): string[] {
  return [
    ...required("language.name", language.name),
    ...required("language.level", language.level),
  ];
}

function validateCertification(certification: Certification): string[] {
  return [
    ...required("certification.name", certification.name),
    ...required("certification.issuer", certification.issuer),
    ...optionalYear("certification.year", certification.year),
  ];
}

function validateEducation(education: Education): string[] {
  return [
    ...required("education.name", education.name),
    ...required("education.issuer", education.issuer),
    ...optionalYear("education.year", education.year),
  ];
}

function validateExperience(experience: Experience): string[] {
  return [
    ...required("experience.company", experience.company),
    ...minLen("experience.positions", experience.positions.length, 1),
    ...validateSlice("experience.positions", experience.positions, validatePosition),
  ];
}

function validatePosition(position: CVPosition): string[] {
  return [
    ...required("cv_position.id", position.id),
    ...minLen("cv_position.roles", position.roles.length, 1),
    ...nonEmptyStrings("cv_position.roles", position.roles),
    ...required("cv_position.start", position.start),
    ...required("cv_position.location", position.location),
    ...minLen("cv_position.tasks", position.tasks.length, 1),
    ...nonEmptyStrings("cv_position.tasks", position.tasks),
    ...nonEmptyStrings("cv_position.keywords", position.keywords ?? []),
  ];
}

function validateProjects(projects: CV["projects"]): string[] {
  return validateSlice("cv.projects.items", projects.items, validateProjectItem);
}

function validateProjectItem(project: CV["projects"]["items"][number]): string[] {
  return [
    ...required("cv_project.name", project.name),
    ...required("cv_project.summary", project.summary),
    ...required("cv_project.description", project.description),
    ...validateSlice("cv_project.links", project.links ?? [], validateLink),
    ...nonEmptyStrings("cv_project.keywords", project.keywords ?? []),
  ];
}

function validateLink(link: Link): string[] {
  return [
    ...required("link.label", link.label),
    ...required("link.url", link.url),
  ];
}

function validateSlice<T>(field: string, values: T[], validate: (value: T) => string[]) {
  return values.flatMap((value, index) => validate(value).map((error) => `${field}[${index}]: ${error}`));
}

function required(field: string, value: string) {
  return hasText(value) ? [] : [`${field} is required`];
}

function minLen(field: string, got: number, want: number) {
  return got >= want ? [] : [`${field} must contain at least ${want} item(s)`];
}

function optionalYear(field: string, value: number) {
  if (value === 0) return [];
  return value >= 1900 && value <= 2100 ? [] : [`${field} must be between 1900 and 2100`];
}

function nonEmptyStrings(field: string, values: string[]) {
  return values.flatMap((value, index) => (hasText(value) ? [] : [`${field}[${index}] is required`]));
}
