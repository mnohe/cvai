# CVAI

[![Tests](https://github.com/mnohe/cvai/actions/workflows/test.yml/badge.svg)](https://github.com/mnohe/cvai/actions/workflows/test.yml)
[![Docker](https://github.com/mnohe/cvai/actions/workflows/docker.yml/badge.svg)](https://github.com/mnohe/cvai/actions/workflows/docker.yml)
[![Coverage](https://codecov.io/gh/mnohe/cvai/graph/badge.svg)](https://codecov.io/gh/mnohe/cvai)

CVAI is an AI-powered system for managing job applications around a structured CV and portfolio.
It helps you keep a private career database, render CV PDFs, ingest job descriptions, compare roles against your experience, and track application
status, with the help of an LLM to understand instructions and interpret unstructured data.

The application is intended for local, single-user use and is distributed as a Docker/Podman container image packaging a Python web app. The location of your private data is configured in the environment variable `CVAI_DATA`.

## Quick Start

Pull and run the published image:

```bash
docker run --rm \
  -p 8080:8080 \
  -e CVAI_DATA=/data \
  -e LLM_API_KEY="${LLM_API_KEY}" \
  -v /path/to/your-data:/data \
  ghcr.io/mnohe/cvai:latest
```

Then open `http://localhost:8080`.

`LLM_API_KEY` is only needed for role ingestion, free-form status updates, and
reassessment. You can browse and edit existing structured data without an LLM.

For a persistent setup, see [Docker Compose](#docker-compose) below.

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
cvai templates import /path/to/template-pack /path/to/your-data
```

Template-pack requirements are documented in [docs/TEMPLATES.adoc](docs/TEMPLATES.adoc).

## Configuration

Set these values in the environment or in a `.env` file inside `CVAI_DATA`:

- `CVAI_DATA`: private writable data directory.
- `LLM_API_KEY`: API token for LLM-backed workflows.
- `LLM_MODEL`: model name.
- `LLM_BASE_URL`: OpenAI-compatible API base URL.
- `LLM_REASONING_EFFORT`: optional reasoning effort override for providers
  that support it. OpenAI GPT-5/o-series models default to `low`.

## Docker Compose

Create a `compose.yaml` pointing at your data directory:

```yaml
services:
  cvai:
    image: ghcr.io/mnohe/cvai:latest
    ports:
      - "8080:8080"
    volumes:
      - /path/to/your-data:/data
    environment:
      CVAI_DATA: /data
      LLM_API_KEY: "${LLM_API_KEY}"
      LLM_MODEL: "${LLM_MODEL:-gpt-5.1}"
      LLM_BASE_URL: "${LLM_BASE_URL:-https://api.openai.com/v1}"
      LLM_REASONING_EFFORT: "${LLM_REASONING_EFFORT:-}"
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

One property of the current design requires a single-pod deployment:

1. **Filesystem write coordination.** Role bundles, action records, and status updates are written as YAML files under `CVAI_DATA`. Concurrent writes from two pods to the same file are not coordinated and will race.

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
          image: ghcr.io/mnohe/cvai:latest
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

CVAI is intended for local single-user deployment, on localhost or trusted LANs. Do not expose it directly to the public internet without adding an authentication layer in front of it. Even then, probably do not expose it.
