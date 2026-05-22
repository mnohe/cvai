MAKEFLAGS += --no-print-directory

CVAI_DATA ?= tests/fixture_data/demo-db
PORT ?= 8080
PYTHON ?= python3

# If there is an .env file, load it.
ifneq (,$(wildcard .env))
include .env
export
endif

.PHONY: test e2e coverage run dev validate cv cv-mr

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
	PYTHONPATH=. $(PYTHON) -m cvai_core.pdf $(CVAI_DATA)/cv/cv.yaml $(CVAI_DATA)/cv/cv.pdf --template portrait --templates-root $(CVAI_DATA)/pdf/templates

cv-mr:
	PYTHONPATH=. $(PYTHON) -m cvai_core.pdf $(CVAI_DATA)/cv/cv.yaml $(CVAI_DATA)/cv/mnoe-cv-mr.pdf --template machine-readable --templates-root $(CVAI_DATA)/pdf/templates
