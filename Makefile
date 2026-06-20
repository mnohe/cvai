MAKEFLAGS += --no-print-directory

FUNCTIONS_DIR := functions
WEB_DIR := web

FIREBASE_PROJECT_ID := demo-cvai
FIRESTORE_EMULATOR_HOST := localhost:8080
FIREBASE_AUTH_EMULATOR_HOST := localhost:9099
FIREBASE := XDG_CONFIG_HOME=$(CURDIR)/.cache/firebase-config firebase
GO_ENV := GOCACHE=$(CURDIR)/.cache/go-build

.PHONY: emulate dev-web test-functions build-functions build-web deploy-functions lint test-rules test-e2e docker-smoke precommit setup

# Start Firebase emulators (auth, firestore, storage, hosting).
# Run the Go backend separately: cd functions && go run ./cmd/...
emulate:
	$(FIREBASE) emulators:start --project $(FIREBASE_PROJECT_ID) --import=emulator-data --export-on-exit=emulator-data

dev-web:
	cd $(WEB_DIR) && npm run dev

# Run Go unit and integration tests against the emulators.
# Requires Firebase emulators to be running (make emulate in another terminal).
test-functions:
	cd $(FUNCTIONS_DIR) && \
		FIRESTORE_EMULATOR_HOST=$(FIRESTORE_EMULATOR_HOST) \
		FIREBASE_AUTH_EMULATOR_HOST=$(FIREBASE_AUTH_EMULATOR_HOST) \
		FIREBASE_PROJECT_ID=$(FIREBASE_PROJECT_ID) \
		$(GO_ENV) go test -race -coverprofile=coverage.out -covermode=atomic ./...

build-functions:
	cd $(FUNCTIONS_DIR) && $(GO_ENV) go build -o /tmp/cvai-functions ./cmd/...

build-web:
	cd $(WEB_DIR) && npm run build

# Deploy the Go backend as a Cloud Run service.
deploy-functions:
	gcloud run deploy cvai \
		--source $(FUNCTIONS_DIR) \
		--region europe-west1 \
		--memory 512Mi \
		--timeout 540 \
		--min-instances 0 \
		--no-allow-unauthenticated

lint:
	cd $(FUNCTIONS_DIR) && $(GO_ENV) go vet ./...

test-rules:
	if curl --silent --output /dev/null http://$(FIRESTORE_EMULATOR_HOST); then \
		npm run test:rules; \
	else \
		$(FIREBASE) emulators:exec --only firestore --project $(FIREBASE_PROJECT_ID) 'npm run test:rules'; \
	fi

# Run Playwright E2E tests. Requires the Firebase Auth emulator to be running.
test-e2e:
	cd $(WEB_DIR) && npm run test:e2e

docker-smoke:
	docker build -f $(FUNCTIONS_DIR)/Dockerfile -t cvai-ci .
	docker rm -f cvai-ci >/dev/null 2>&1 || true
	docker run -d --name cvai-ci \
		-p 18080:8080 \
		-e FIREBASE_PROJECT_ID=$(FIREBASE_PROJECT_ID) \
		-e FIRESTORE_EMULATOR_HOST=127.0.0.1:8081 \
		-e FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
		-e LLM_PROVIDER=openai \
		-e LLM_API_KEY=dummy-smoke-test-key \
		-e LLM_MODEL=dummy-smoke-test-model \
		cvai-ci
	for i in $$(seq 1 20); do \
		if curl --fail http://localhost:18080/healthz; then \
			docker rm -f cvai-ci; \
			exit 0; \
		fi; \
		docker logs cvai-ci || true; \
		sleep 1; \
	done; \
	docker logs cvai-ci || true; \
	docker rm -f cvai-ci; \
	exit 1

precommit: lint build-functions build-web test-rules docker-smoke
	if curl --silent --output /dev/null http://$(FIRESTORE_EMULATOR_HOST) && \
		curl --silent --output /dev/null http://$(FIREBASE_AUTH_EMULATOR_HOST); then \
		$(MAKE) test-functions test-e2e; \
	else \
		$(FIREBASE) emulators:exec --only auth,firestore --project $(FIREBASE_PROJECT_ID) '$(MAKE) test-functions test-e2e'; \
	fi

# Generate go.sum and tidy module graph. Run once after first checkout.
setup:
	cd $(FUNCTIONS_DIR) && go mod tidy
