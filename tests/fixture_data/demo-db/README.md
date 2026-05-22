# CVAI Demo Data

This directory is a fictional, self-contained CVAI datastore for development, demos and screenshots.
Every person, employer, role, URL, and event is made up, but the files are structured to look and behave like a realistic job-search database.

Use it with the web app by setting:

```sh
CVAI_DATA=/workspaces/cvai/tests/fixture_data/demo-db python3 -m cvai_web.server
```

The dataset intentionally includes:

- A complete CV using every supported top-level CV section and optional fields.
- Active and terminal role states: draft, submitted, interviewing, accepted, rejected,
  closed, and inactive.
- Global and role-linked tasks with open, completed, and wont_do statuses.
- Per-role job descriptions, structured job facts, analysis, suitability reports,
  role matrices, events, and artifacts.
- Context and library files used by reassessment and application-material generation.
