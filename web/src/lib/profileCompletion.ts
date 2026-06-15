import type { Candidate } from "@/lib/types";

export interface CompletionSegment {
  id: "personal" | "experience" | "story" | "education" | "evidence";
  label: string;
  complete: boolean;
}

export interface CompletionState {
  score: number;
  segments: CompletionSegment[];
}

export function getProfileCompletion(candidate?: Partial<Candidate>): CompletionState {
  const cv = candidate?.cv as Record<string, unknown> | undefined;
  const personal = cv?.personal as Record<string, unknown> | undefined;
  const contact = cv?.contact as Record<string, unknown> | undefined;

  const hasPersonalName =
    hasText(personal?.name) ||
    hasText(contact?.name) ||
    hasText(contact?.surname);
  const hasContact =
    hasText(personal?.email) ||
    hasText(personal?.phone) ||
    hasText(contact?.email) ||
    hasText((contact?.phone as Record<string, unknown> | undefined)?.number) ||
    hasText(contact?.linkedin);

  const segments: CompletionSegment[] = [
    {
      id: "personal",
      label: "Personal details",
      complete: hasPersonalName && hasContact,
    },
    {
      id: "experience",
      label: "Work experience",
      complete: Array.isArray(cv?.experience) && cv.experience.length > 0,
    },
    {
      id: "story",
      label: "Story",
      complete:
        Array.isArray(candidate?.story_bank) && candidate.story_bank.length > 0,
    },
    {
      id: "education",
      label: "Education",
      complete: Array.isArray(cv?.education) && cv.education.length > 0,
    },
    {
      id: "evidence",
      label: "Portfolio evidence",
      complete:
        Array.isArray(candidate?.evidence_library) &&
        candidate.evidence_library.length > 0,
    },
  ];

  return {
    score: segments.filter((segment) => segment.complete).length,
    segments,
  };
}

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
