package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/mnohe/cvai/functions/internal/auth"
	"github.com/mnohe/cvai/functions/internal/repo"
)

// AccountHandler handles account-related HTTP routes.
type AccountHandler struct {
	accounts repo.AccountRepository
}

// NewAccountHandler creates an AccountHandler.
func NewAccountHandler(accounts repo.AccountRepository) *AccountHandler {
	return &AccountHandler{accounts: accounts}
}

// GetAccount handles GET /account.
// Creates the account document on first read (zero credits, has_ever_purchased: false).
func (h *AccountHandler) GetAccount(w http.ResponseWriter, r *http.Request) {
	uid := auth.UIDFromContext(r.Context())
	acc, err := h.accounts.GetProfile(r.Context(), uid)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, "failed to get account")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(acc)
}

func writeJSONError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
