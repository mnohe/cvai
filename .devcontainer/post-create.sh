#!/bin/bash
set -euo pipefail

# Generate go.sum from the declared dependencies.
# This must run before any go build or go test invocation.
(cd functions && go mod tidy)
