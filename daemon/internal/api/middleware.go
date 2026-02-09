package api

import (
	"crypto/subtle"
	"net/http"
	"strings"
)

func AuthMiddleware(token string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if token == "" {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "server token is not configured"})
			return
		}

		header := r.Header.Get("Authorization")
		const prefix = "Bearer "
		if !strings.HasPrefix(header, prefix) {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "missing or invalid authorization header"})
			return
		}

		provided := strings.TrimSpace(strings.TrimPrefix(header, prefix))
		if subtle.ConstantTimeCompare([]byte(provided), []byte(token)) != 1 {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "invalid token"})
			return
		}

		next.ServeHTTP(w, r)
	})
}
