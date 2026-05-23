# CVAI

[![Tests](https://github.com/mnohe/cvai/actions/workflows/test.yml/badge.svg)](https://github.com/mnohe/cvai/actions/workflows/test.yml)
[![Docker](https://github.com/mnohe/cvai/actions/workflows/docker.yml/badge.svg)](https://github.com/mnohe/cvai/actions/workflows/docker.yml)
[![Coverage](https://codecov.io/gh/mnohe/cvai/graph/badge.svg)](https://codecov.io/gh/mnohe/cvai)

CVAI is an AI-powered system for managing job applications around a structured CV and portfolio.
It helps you keep a private career database, render CV PDFs, ingest job descriptions, compare roles against your experience, and track application
status, with the help of an LLM to understand instructions and interpret unstructured data.

The application is intended for local, single-user use and is distributed as a Docker/Podman container image packaging a Python web app. The location of your private data is configured in the environment variable `CVAI_DATA`.

## Quick Start

Build and run the app locally:

```bash
cd /path/to/cvai
docker build -t cvai:local .
docker run --rm \
  -p 8080:8080 \
  -e CVAI_DATA=/data \
  -e LLM_API_KEY="${LLM_API_KEY}" \
  -v "$PWD/tests/fixture_data/demo-db:/data" \
  cvai:local
```

Then open `http://localhost:8080`.

If you prefer running from a source checkout without Docker:

```bash
PYTHONPATH=. python3 -m cvai_web validate tests/fixture_data/demo-db
PYTHONPATH=. CVAI_DATA=tests/fixture_data/demo-db python3 -m cvai_web serve
```

For local development, the Makefile defaults `CVAI_DATA` to
`tests/fixture_data/demo-db`, a public demo datastore with realistic sample
content. This lets `make dev` start a live-reloading server immediately:

```bash
make dev
```

Use a separate writable datastore for real applications:

```bash
make dev CVAI_DATA=/path/to/your-data
```

`LLM_API_KEY` is only needed for role ingestion, free-form status updates, and
reassessment. You can browse and edit existing structured data without an LLM.

## Quick Tour

1. Open `http://localhost:8080`.
2. Go to **CV**. On a fresh data directory, CVAI creates the surrounding data
   structure and shows where the structured CV file belongs. Once `cv/cv.yaml`
   exists, the page lets you edit the CV with form controls instead of raw YAML.
3. Import a PDF template pack, then use **Download current PDF** from the CV page
   to render the CV.
4. Go to **Ingest Role** and paste a job URL or job-description text. CVAI asks
   the configured LLM to turn the posting into structured YAML and creates a role
   detail page.
5. Use the dashboard to track active roles, open tasks, status updates, and
   generated artifacts.

## Main Features

- **Structured private data.** CVAI reads and writes YAML under `CVAI_DATA`.
  Dashboard rows, role details, statuses, tasks, events, and artifact links are
  deterministic reads from those files.
- **CV editor.** Edit contact details, summary, languages, certifications,
  education, experience, and projects using browser forms and modal subforms.
- **PDF rendering.** Render `cv/cv.yaml` through Typst template packs installed in
  `CVAI_DATA/pdf/templates/<template>`.
- **Role ingestion.** Use an LLM to turn a job posting URL or pasted description
  into structured `job.yaml`, `analysis.yaml`, tasks, and human-readable
  artifacts.
- **Requirement coverage.** Review how role requirements map to your evidence,
  with gaps linked to actionable tasks.
- **Status updates.** Record structured application events, or use an LLM to
  interpret a free-form update prompt.

## PDF Templates

Templates are separate template packs so they can be versioned and shared
independently from the application and your configured data directory.

The demo fixture includes a minimal `demo` template. Custom template packs can be
imported into your configured data directory when you want a different CV
presentation.

Import a local template checkout with:

```bash
cvai templates import /path/to/template-pack tests/fixture_data/demo-db
```

Template-pack requirements are documented in [docs/TEMPLATES.adoc](docs/TEMPLATES.adoc).

## Configuration

Set these values in the environment or in a `.env` file inside `CVAI_DATA`:

- `CVAI_DATA`: private writable data directory.
- `LLM_API_KEY`: API token for LLM-backed workflows.
- `LLM_MODEL`: model name.
- `LLM_BASE_URL`: OpenAI-compatible API base URL.

When using the Makefile from a source checkout, `CVAI_DATA` defaults to the
checked-in demo datastore at `tests/fixture_data/demo-db`; Docker examples use
`/data` because they expect a mounted private data directory. `make run` and
other Makefile targets also load a repo-root `.env` file when one is present.

## Docker

```bash
docker build -t cvai .
docker run --rm -p 8080:8080 -e CVAI_DATA=/data -e LLM_API_KEY -v "$PWD/tests/fixture_data/demo-db:/data" cvai
```

## Docker Compose

Use the checked-in compose file from the source checkout, or create an equivalent
file with the demo datastore mounted:

```yaml
services:
  cvai:
    image: cvai
    build: /path/to/cvai          # or use image: ghcr.io/mnohe/cvai:latest
    ports:
      - "8080:8080"
    volumes:
      - ./tests/fixture_data/demo-db:/data
    environment:
      CVAI_DATA: /data
      LLM_API_KEY: "${LLM_API_KEY}"
      LLM_MODEL: "${LLM_MODEL:-gpt-4o}"
      LLM_BASE_URL: "${LLM_BASE_URL:-https://api.openai.com/v1}"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8080/healthz"]
      interval: 30s
      timeout: 5s
      retries: 3
```

Then run:

```bash
docker compose up -d
```

Set `LLM_API_KEY` in a `.env` file beside the compose file or export it in your shell. *Do not commit the `.env` file*.

## Kubernetes

**Run exactly one replica.** Do not set `replicas` above 1 without additional infrastructure changes.

Two properties of the current design require a single-pod deployment:

1. **In-memory operation state.** Background ingestion and reassessment operations are tracked in a process-local dict. A browser polling `/operations/{id}/fragment` will receive a 404 if the request is routed to a different pod than the one that started the operation.
2. **Filesystem write coordination.** Role bundles and status updates are written as YAML files under `CVAI_DATA`. Concurrent writes from two pods to the same file are not coordinated and will race.

A minimal deployment for a home-lab cluster:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cvai
spec:
  replicas: 1         # do not increase — see above
  strategy:
    type: Recreate    # avoid two pods running simultaneously during rollouts
  selector:
    matchLabels:
      app: cvai
  template:
    metadata:
      labels:
        app: cvai
    spec:
      containers:
        - name: cvai
          image: ghcr.io/you/cvai:latest
          ports:
            - containerPort: 8080
          env:
            - name: CVAI_DATA
              value: /data
            - name: LLM_API_KEY
              valueFrom:
                secretKeyRef:
                  name: cvai-secrets
                  key: llm-api-key
          volumeMounts:
            - name: data
              mountPath: /data
          livenessProbe:
            httpGet:
              path: /healthz
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 30
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: cvai-storage
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: cvai-storage
spec:
  accessModes:
    - ReadWriteOnce   # sufficient for a single pod; use ReadWriteMany only if your storage class supports it
  resources:
    requests:
      storage: 1Gi
```

Create the secrets before deploying:

```bash
kubectl create secret generic cvai-secrets \
  --from-literal=llm-api-key="$LLM_API_KEY"
```

The `Recreate` rollout strategy ensures the old pod terminates before the new one starts, preventing two writers from sharing the data volume during a rolling update.

## Security

This package is intended to be public. Do not store private candidate data, `.env`, or generated role artifacts here.

CVAI is intended for local single-user deployment, on localhost or trusted LANs. Do not expose it directly to the public internet without adding an authentication layer in front of it.
