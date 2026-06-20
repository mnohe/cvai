import type {
  CV,
  CVPosition,
  Candidate,
  Certification,
  Education,
  Experience,
  Language,
} from "@/lib/types";

export const emptyCV: CV = {
  summary: "",
  contact: {
    name: "",
    surname: "",
    phone: { prefix: "", number: "" },
    email: "",
    linkedin: "",
    github: "",
    www: "",
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
  return {
    ...emptyCV,
    ...cv,
    contact: {
      ...emptyCV.contact,
      ...cv?.contact,
      phone: {
        ...emptyCV.contact.phone,
        ...cv?.contact?.phone,
      },
    },
    languages: cv?.languages ?? [],
    skills: cv?.skills ?? [],
    certifications: cv?.certifications ?? [],
    education: cv?.education ?? [],
    experience: cv?.experience ?? [],
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
        hasText(cv.contact.linkedin),
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
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
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
    cv.contact.linkedin,
    cv.contact.github,
    cv.contact.www,
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
    location: "",
    tasks: [],
  };
}
