MAKEFLAGS += --no-print-directory

FUNCTIONS_DIR := functions
WEB_DIR := web

.PHONY: emulate test-functions build-functions deploy-functions lint test-e2e setup

# Start Firebase emulators (auth, firestore, storage, hosting).
# Run the Go backend separately: cd functions && go run ./cmd/...
emulate:
	firebase emulators:start --project demo-cvai --import=emulator-data --export-on-exit=emulator-data

# Run Go unit and integration tests against the emulators.
# Requires Firebase emulators to be running (make emulate in another terminal).
test-functions:
	cd $(FUNCTIONS_DIR) && \
		FIRESTORE_EMULATOR_HOST=localhost:8080 \
		FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 \
		FIREBASE_PROJECT_ID=demo-cvai \
		go test -race ./...

build-functions:
	cd $(FUNCTIONS_DIR) && go build ./cmd/...

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
	cd $(FUNCTIONS_DIR) && go vet ./...

# Run Playwright E2E tests. Requires emulators and web dev server running.
test-e2e:
	cd $(WEB_DIR) && npx playwright test

# Generate go.sum and tidy module graph. Run once after first checkout.
setup:
	cd $(FUNCTIONS_DIR) && go mod tidy
