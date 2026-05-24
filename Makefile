MAKEFLAGS += --no-print-directory

CVAI_DATA ?= tests/fixture_data/demo-db
PORT ?= 8080
PYTHON ?= python3

# If there is an .env file, load it.
ifneq (,$(wildcard .env))
include .env
export
endif

# Ephemeral Debian+Playwright container spawned via the host Podman socket.
# HOST_WORKDIR is set automatically in the devcontainer via ${localWorkspaceFolder}.
# Three named volumes cache pip packages, apt archives, and the Playwright browser
# binary so that only the first invocation is slow.
BROWSER_RUN = docker run --rm \
    -v "$(HOST_WORKDIR):/workspaces/cvai" \
    -v cvai-pip:/root/.cache/pip \
    -v cvai-apt:/var/cache/apt/archives \
    -v cvai-playwright:/usr/local/ms-playwright \
    -e PLAYWRIGHT_BROWSERS_PATH=/usr/local/ms-playwright \
    -e PYTHONPATH=/workspaces/cvai \
    -e CVAI_DATA=$(CVAI_DATA) \
    -w /workspaces/cvai \
    python:slim

BROWSER_INSTALL = pip install -q --cache-dir /root/.cache/pip playwright -r requirements.txt \
    && playwright install --with-deps chromium

.PHONY: test e2e coverage run dev validate cv docs test-e2e

test:
	PYTHONPATH=. $(PYTHON) -m unittest discover -s tests -v

e2e:
	PYTHONPATH=. $(PYTHON) -m unittest tests.test_e2e -v

coverage:
	PYTHONPATH=. $(PYTHON) -m coverage run -m unittest discover -s tests -v
	$(PYTHON) -m coverage report -m
	$(PYTHON) -m coverage xml

run:
	PYTHONPATH=. CVAI_DATA=$(CVAI_DATA) PORT=$(PORT) $(PYTHON) -m cvai_web serve

dev:
	PYTHONPATH=. CVAI_DATA=$(CVAI_DATA) $(PYTHON) -m uvicorn cvai_web.asgi:app --host 0.0.0.0 --port $(PORT) --reload

validate:
	PYTHONPATH=. $(PYTHON) -m cvai_core.schema $(CVAI_DATA)

cv:
	PYTHONPATH=. $(PYTHON) -m cvai_core.pdf $(CVAI_DATA)/cv/cv.yaml $(CVAI_DATA)/cv/cv.pdf --template demo --templates-root $(CVAI_DATA)/pdf/templates

docs:
	$(BROWSER_RUN) sh -c "$(BROWSER_INSTALL) && python3 scripts/docs.py"

test-e2e:
	$(BROWSER_RUN) sh -c "$(BROWSER_INSTALL) && python3 -m pytest tests/test_browser.py -v"
