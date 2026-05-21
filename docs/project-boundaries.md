# Project Boundaries

`cvai` is the public-safe application. It owns HTTP routing, HTML
templates, the YAML schema, validation, and data-directory initialization.

Private application data belongs outside this repository and is supplied at
runtime through `CVAI_DATA`. PDF rendering code is called through
`cvai_core.pdf`; layouts and fonts are data assets under
`CVAI_DATA/pdf/layouts/<layout>/`.

## Data Contract

The web app renders dashboards, role details, tasks, statuses, events, and
artifact links from structured YAML. Normal page reads must not call an LLM.

LLMs are only for interpreting free-form user input, extracting structured data
from unstructured job postings, generating artifacts, and reassessing structured
analysis when the user asks for it.

Role IDs are readable slugs, for example:

```text
amazon_dublin_software_development_engineer_network_capacity_services
```

If a title-derived slug collides, add a deterministic suffix such as a posting ID
or `_2`; do not mix slug IDs and UUID IDs for roles.

Events use UUIDs with an `event-` prefix because event order can change and
mirrors may be written independently.
