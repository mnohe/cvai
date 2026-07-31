// Package health implements the backend's deep health check: liveness plus
// a real, short-timeout Firestore probe, so Cloud Run and an operator can
// tell "process is up" apart from "process is up but can't reach its
// database" instead of /healthz always reporting ok regardless.
package health

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"cloud.google.com/go/firestore"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// probeTimeout bounds how long the Firestore probe can add to a health
// check request, so a struggling dependency degrades the check quickly
// instead of risking Cloud Run's own health-check timeout.
const probeTimeout = 2 * time.Second

// Handler serves a deep health check: always live (the process answered at
// all), plus a real Firestore round trip. A missing probe document is
// treated as healthy — the probe only needs to prove Firestore is
// reachable and authorized, not that specific data exists.
func Handler(fsClient *firestore.Client) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), probeTimeout)
		defer cancel()

		firestoreStatus := "ok"
		httpStatus := http.StatusOK
		if err := probeFirestore(ctx, fsClient); err != nil {
			firestoreStatus = "unavailable"
			httpStatus = http.StatusServiceUnavailable
		}

		body := struct {
			Status       string            `json:"status"`
			Dependencies map[string]string `json:"dependencies"`
		}{
			Status:       overallStatus(httpStatus),
			Dependencies: map[string]string{"firestore": firestoreStatus},
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(httpStatus)
		_ = json.NewEncoder(w).Encode(body)
	})
}

func probeFirestore(ctx context.Context, client *firestore.Client) error {
	_, err := client.Collection("_health").Doc("ping").Get(ctx)
	if err != nil && status.Code(err) == codes.NotFound {
		return nil
	}
	return err
}

func overallStatus(httpStatus int) string {
	if httpStatus == http.StatusOK {
		return "ok"
	}
	return "degraded"
}
