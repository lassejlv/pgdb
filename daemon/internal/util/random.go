package util

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"math/big"
	"strings"
)

const alphaNumLower = "abcdefghijklmnopqrstuvwxyz0123456789"

func RandomLowerAlphaNum(n int) (string, error) {
	if n <= 0 {
		return "", fmt.Errorf("n must be > 0")
	}

	b := make([]byte, n)
	for i := 0; i < n; i++ {
		idx, err := rand.Int(rand.Reader, big.NewInt(int64(len(alphaNumLower))))
		if err != nil {
			return "", fmt.Errorf("generate random index: %w", err)
		}
		b[i] = alphaNumLower[idx.Int64()]
	}

	return string(b), nil
}

func RandomPassword(minLen int) (string, error) {
	if minLen < 24 {
		minLen = 24
	}

	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("generate random password bytes: %w", err)
	}

	out := base64.RawURLEncoding.EncodeToString(raw)
	if len(out) < minLen {
		return "", fmt.Errorf("generated password too short")
	}

	return strings.TrimSpace(out), nil
}
