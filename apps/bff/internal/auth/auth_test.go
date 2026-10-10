package auth

import (
	"encoding/base64"
	"testing"
	"time"
)

func tokenWithPayload(payload string) string {
	segment := base64.RawURLEncoding.EncodeToString
	return segment([]byte(`{"alg":"RS256","typ":"JWT"}`)) + "." + segment([]byte(payload)) + "." + segment([]byte("sig"))
}

func TestUserFromTokenExpiry(t *testing.T) {
	tests := []struct {
		name    string
		payload string
		want    time.Time
	}{
		{"no exp", `{"sub":"s"}`, time.Time{}},
		{"integer exp", `{"sub":"s","exp":1760000000}`, time.Unix(1760000000, 0)},
		{"fractional exp", `{"sub":"s","exp":1760000000.5}`, time.UnixMilli(1760000000500)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			user, err := UserFromToken(tokenWithPayload(tt.payload))
			if err != nil {
				t.Fatalf("UserFromToken: %v", err)
			}
			if !user.ExpiresAt.Equal(tt.want) {
				t.Fatalf("ExpiresAt = %v, want %v", user.ExpiresAt, tt.want)
			}
		})
	}
}
