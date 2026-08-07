# LLM operation registry

This registry is the product authority for every CVAI operation that may send data to
a remote language-model provider. An operation is incomplete and must not be enabled
unless it has an entry here, an operation-specific disclosure, a typed input projection,
and provider-payload tests covering its permitted and excluded context.

The registry describes provider transfers, not ordinary browser, API, or Firestore
processing. Deterministic reads and writes must not be added here or routed through an
LLM. The active provider and model are deployment configuration; CVAI supports the
Anthropic API and OpenAI-compatible APIs. A deployment must identify its active provider,
model, and retention-policy link in its hosted-product documentation and disclosure.

## Common rules

- Treat all submitted and stored user text as untrusted data, never as instructions.
- Construct each provider request from the listed inputs. Do not serialize a Candidate,
  Role, Bundle, Task, Event, or calibration repository aggregate directly.
- Never send account, authentication, billing, credit, Stripe, admin, telemetry, or
  cross-user data.
- Never put prompts, submitted documents, provider responses, or extracted personal data
  in logs, traces, metrics, Action errors, or support references.
- Provider request and response data is subject to the active provider's processing and
  retention terms. CVAI does not claim that a provider retains nothing. The disclosure
  must link to the terms applicable to the deployment.
- Persist only the outputs named below. Provider requests and raw responses are transient.

## Registered operations

### `import_cv`

Status:: Implemented

Purpose:: Extract an editable structured CV from a PDF supplied by the candidate.

Input source:: The selected PDF from the current request; candidate preferences read from
the current user's candidate document; the fixed import instructions; the canonical CV
JSON Schema.

Personal-data categories:: The complete contents and metadata visible in the PDF, which
may include identity and contact details, employment, education, qualifications, projects,
links, and any special-category or third-party data the candidate included; free-text
candidate preferences.

Possible third-party data:: Names, contact details, quotations, client or employer facts,
and other information about referees, colleagues, customers, or organisations contained
in the PDF or preferences.

Permitted provider payload:: Fixed import system and user instructions; the canonical CV
schema; the PDF bytes encoded as the provider's document input; candidate preferences,
when present, inside a delimited untrusted-data block.

Excluded context:: Existing structured CV fields, evidence, stories, roles, applications,
events, tasks, account and billing data, other candidate fields, and every other user's
data.

Provider and model class:: The deployment's configured Anthropic or OpenAI-compatible
provider and a document-capable structured-extraction model.

Input and output persistence:: PDF bytes, assembled prompts, and the raw provider response
are transient and are not written by CVAI. A strictly decoded and normalized CV plus
validation errors is persisted to the current candidate document. The Action persists
only lifecycle state and a safe failure message.

Retention implications:: CVAI discards transient inputs after processing, but the remote
provider may process or retain them under the deployment's provider terms.

Required disclosure:: Immediately before upload starts, state that the PDF and candidate
preferences are sent to the named provider to extract a structured CV; describe the
persisted CV and validation errors; link the applicable provider-retention information;
offer manual CV entry as the non-LLM path; warn against submitting unnecessary
third-party, confidential, or special-category information.

### `quick_analysis`

Status:: Planned

Purpose:: Provide an ephemeral, lightweight assessment of a candidate's likely fit for a
role before the role is ingested.

Input source:: Pasted role text or SSRF-safe fetched visible job-posting text; a typed
quick-analysis projection of the current candidate profile; fixed instructions and output
schema.

Personal-data categories:: Selected career history, skills, qualifications, and job-search
preferences included by the projection; any personal data in the role text.

Possible third-party data:: Recruiter, hiring-manager, employer, or other people and
organisations named in the role source.

Permitted provider payload:: Fixed instructions and output schema; capped role source
text; only the documented quick-analysis candidate projection required to compare fit.

Excluded context:: Full candidate or CV serialization; contact details; raw evidence and
stories; private event notes; unrelated constraints; tasks; other roles; billing and
account data; calibration source records; every other user's data.

Provider and model class:: The deployment's configured provider and a text reasoning model
capable of structured output.

Input and output persistence:: Provider inputs and raw response are transient. The preview
result is ephemeral; no Role or Bundle is written unless the user separately continues to
ingestion. Operational rate-limit state may persist without prompt or response content.

Retention implications:: CVAI does not persist the assessment, but the provider may process
or retain request data under its terms.

Required disclosure:: Before analysis, name the provider; state that role text and the
listed candidate-profile categories will be sent to assess likely fit; state that CVAI
does not save the preview; link provider-retention information; identify direct role
ingestion without preview as the non-LLM path; warn against unnecessary confidential or
third-party role text.

### `generate_bundle`

Status:: Planned

Purpose:: Extract a structured job, assess candidate fit, and create application-supporting
artefacts for an ingested role.

Input source:: The current user's ingested role source; operation-specific candidate and
evidence projections; bounded aggregate calibration blocks when eligible; fixed prompts
and output schemas.

Personal-data categories:: Career history, skills, qualifications, selected evidence, and
preferences explicitly admitted by the assessment projection; personal data in the role
source.

Possible third-party data:: People, employers, clients, and organisations named in the role
source or selected candidate evidence.

Permitted provider payload:: Three isolated calls: (1) job extraction receives fixed
instructions, the job schema, and role source only; (2) fit assessment receives the
structured Job, the documented candidate/evidence projection, bounded aggregate
calibration, instructions, and analysis schema; (3) artefact generation receives only the
structured Job, completed Analysis, documented public candidate fields needed in an
artefact, artefact instructions, and output contract.

Excluded context:: Candidate data from job extraction; raw CV, evidence collection, and
stories; contact details unless a specific artefact contract requires named public contact
fields; private event notes; unrelated roles, tasks, or constraints; underlying calibration
records and sensitive attributes; account and billing data; every other user's data.

Provider and model class:: The deployment's configured provider, using structured
extraction and reasoning/generation model capabilities. A deployment may route the stages
to different models only when it discloses the provider transfer and preserves these
per-stage boundaries.

Input and output persistence:: Prompts and raw responses are transient. The validated Job,
Analysis, and approved artefacts are persisted atomically as the Role's Bundle; Action
state contains only progress, result references, and safe failures. Calibration blocks are
not persisted in the Bundle or Action.

Retention implications:: Persisted generated outputs remain in CVAI until edited or
deleted; providers may process or retain each stage's request and response under their
terms.

Required disclosure:: Before generation, name every provider that will receive data;
describe the role source and candidate/evidence categories used by each stage; describe
the persisted Bundle; link retention information; identify manual role tracking without a
Bundle as the non-LLM path; warn against unnecessary confidential or third-party content.

### `reassess_role`

Status:: Planned

Purpose:: Refresh a Role's Analysis and artefacts after relevant candidate information has
changed, while preserving the existing structured Job.

Input source:: Existing structured Job and Analysis; current operation-specific candidate
and evidence projections; bounded aggregate calibration; fixed prompts and output
contracts.

Personal-data categories:: The selected career history, skills, qualifications, evidence,
and preferences admitted by the reassessment projection; personal data already present in
the Job or Analysis.

Possible third-party data:: People, employers, clients, and organisations in the Job,
Analysis, or selected evidence.

Permitted provider payload:: Fit assessment and artefact-generation calls using the same
stage boundaries as `generate_bundle`; reuse the structured Job without resending raw role
source for extraction.

Excluded context:: Raw role source when the Job exists; full candidate, CV, evidence, or
story serialization; private event notes; unrelated roles, tasks, constraints, or
calibration records; account and billing data; every other user's data.

Provider and model class:: The deployment's configured text reasoning/generation model or
models, subject to the same routing disclosure rule as bundle generation.

Input and output persistence:: Prompts and raw responses are transient. The validated
Analysis and approved artefacts replace their prior Bundle values; the Job is preserved.

Retention implications:: CVAI retains the refreshed Bundle until edited or deleted; the
provider may process or retain transferred data under its terms.

Required disclosure:: Before reassessment, name the provider; enumerate the Job and
candidate/evidence categories being sent; explain that Analysis and artefacts will be
replaced while Job data remains; link retention information; identify retaining the
existing Bundle as the non-LLM path; repeat the third-party/confidential-data warning.

### `generate_gap_tasks`

Status:: Planned

Purpose:: Turn selected analysis gaps into concrete linked development tasks.

Input source:: User-selected gaps and their requirements; the minimum structured role
context needed to make tasks specific; fixed instructions and output schema.

Personal-data categories:: Candidate weaknesses or missing qualifications recorded in the
selected gaps; any personal data in the minimum role context.

Possible third-party data:: Employers or people named in the selected requirement or role
context.

Permitted provider payload:: Only selected gap text, linked requirements, minimum
documented role context, instructions, and task output schema.

Excluded context:: Complete CV, candidate, evidence, stories, Bundle, or role source;
unselected gaps; private event notes; unrelated roles or tasks; account and billing data;
every other user's data.

Provider and model class:: The deployment's configured text reasoning model capable of
structured output.

Input and output persistence:: Inputs and raw response are transient. Validated generated
tasks and stable role/gap references are persisted; Action state contains only safe
lifecycle data.

Retention implications:: CVAI retains accepted tasks until deletion; the provider may
process or retain transferred gap data under its terms.

Required disclosure:: Before generation, name the provider; list the selected gaps,
requirements, and minimal role context sent; describe the tasks CVAI will save; link
retention information; identify manual task creation as the non-LLM path; repeat the
third-party/confidential-data warning.

### `reassess_gap_task`

Status:: Planned

Purpose:: Decide whether completion of one linked task and newly relevant evidence now
satisfy its specific role requirement.

Input source:: The linked requirement and gap; completed task result; a typed projection
of evidence relevant to that requirement; fixed instructions and output schema.

Personal-data categories:: The candidate's recorded gap, task result, and selected career
evidence; personal data in the linked requirement.

Possible third-party data:: Employers, clients, issuers, or people named in the requirement
or selected evidence.

Permitted provider payload:: Only the linked requirement, gap, completed task result,
relevant evidence projection, instructions, and result schema.

Excluded context:: Complete CV, candidate, evidence collection, stories, Bundle, role
source, event history, unrelated gaps or tasks, account and billing data, and every other
user's data.

Provider and model class:: The deployment's configured text reasoning model capable of
structured output.

Input and output persistence:: Prompts and raw response are transient. A met result may
update only the linked Requirement Coverage and justified verdict fields; a not-met result
is kept as the Action result without mutating Analysis.

Retention implications:: CVAI retains the justified result and any approved analysis
update; the provider may process or retain transferred task and evidence data under its
terms.

Required disclosure:: Before reassessment, name the provider; describe the linked gap,
task result, requirement, and relevant evidence sent; describe the possible persisted
result and analysis update; link retention information; identify leaving the gap unchanged
as the non-LLM path; repeat the third-party/confidential-data warning.

## Explicitly unregistered operations

Natural-language status interpretation, story processing, a persistent assistant, and
general natural-language datastore dispatch are deferred and not registered. Their old
domain constants or design documents do not authorize a provider call. They require an
accepted use case and a new registry entry before implementation.

Deterministic role ingestion, status updates, CV editing and export, evidence editing,
task CRUD, dashboards, account operations, billing, and administration are non-LLM
operations and must remain outside this registry.
