package webserver

import (
	"net/http"
	"strconv"

	"github.com/gorilla/mux"
)

// parseServerID extracts and parses the server_id query parameter.
// Returns the default value of 1 if not provided.
func parseServerID(r *http.Request) (int64, error) {
	serverIDStr := r.URL.Query().Get("server_id")
	if serverIDStr == "" {
		return 1, nil
	}
	return strconv.ParseInt(serverIDStr, 10, 64)
}

// parseMatchIDParam extracts and parses the match ID from URL path variables.
func parseMatchIDParam(r *http.Request) (int64, error) {
	vars := mux.Vars(r)
	return strconv.ParseInt(vars["id"], 10, 64)
}
