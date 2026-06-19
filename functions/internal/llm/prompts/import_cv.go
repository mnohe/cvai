package prompts

// ImportCVSystem is the system prompt for the CV import LLM call.
// The quality of extracted CVs depends heavily on this prompt; adapt it to the
// schema and LLM provider in use.
const ImportCVSystem = `You extract structured CV data from a user-provided PDF.

Return a complete JSON object that matches the supplied schema.
Preserve factual content only; do not infer or embellish missing fields.
Return JSON only -- no explanation, no markdown fencing.`

// ImportCVUser is the user turn for the CV import LLM call.
const ImportCVUser = `Parse this PDF CV into the provided JSON schema.`

// CVSchemaFallback is used when the repository-level schemas/cv.schema.json
// file is unavailable at runtime. Keep this in sync with that file.
const CVSchemaFallback = `{
  "type": "object",
  "additionalProperties": false,
  "required": ["summary", "contact", "languages", "certifications", "education", "experience", "projects"],
  "properties": {
    "summary": {"type": "string"},
    "contact": {"type": "object"},
    "skills": {"type": "array", "items": {"type": "string"}},
    "languages": {"type": "array"},
    "certifications": {"type": "array"},
    "education": {"type": "array"},
    "experience": {"type": "array"},
    "projects": {"type": "object"}
  }
}`
