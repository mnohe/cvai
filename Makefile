MAKEFLAGS += --no-print-directory

DATA ?= ../cvai-data
PYTHON ?= python3

.PHONY: test e2e coverage run validate cv cv-mr

test:
	PYTHONPATH=. $(PYTHON) -m unittest discover -s tests -v

e2e:
	PYTHONPATH=. $(PYTHON) -m unittest tests.test_e2e -v

coverage:
	PYTHONPATH=. $(PYTHON) -m coverage run -m unittest discover -s tests -v
	$(PYTHON) -m coverage report -m
	$(PYTHON) -m coverage xml

run:
	PYTHONPATH=. CVAI_DATA=$(DATA) $(PYTHON) -m cvai_web serve

validate:
	PYTHONPATH=. $(PYTHON) -m cvai_core.schema $(DATA)

cv:
	PYTHONPATH=. $(PYTHON) -m cvai_core.pdf $(DATA)/cv/cv.yaml $(DATA)/cv/cv.pdf --layout portrait --layouts-root $(DATA)/pdf/layouts

cv-mr:
	PYTHONPATH=. $(PYTHON) -m cvai_core.pdf $(DATA)/cv/cv.yaml $(DATA)/cv/mnoe-cv-mr.pdf --layout machine-readable --layouts-root $(DATA)/pdf/layouts
