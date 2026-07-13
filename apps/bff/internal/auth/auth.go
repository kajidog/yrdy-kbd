// Package auth extracts the caller identity from the Cognito-issued JWT in
// the Authorization header. The BFF does not verify the token signature:
// requests reach it through CloudFront, where a Lambda@Edge function has
// already verified the issuer and signature.
package auth

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
)

type User struct {
	ID   string
	Name string
}

type contextKey struct{}

// Middleware attaches the authenticated user to the request context when a
// valid bearer token is present. Requests without one pass through without a
// user; resolvers reject them via FromContext.
func Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if user, err := UserFromRequest(r); err == nil {
			r = r.WithContext(context.WithValue(r.Context(), contextKey{}, user))
		}
		next.ServeHTTP(w, r)
	})
}

// FromContext returns the user attached by Middleware, or an error suitable
// for surfacing as a GraphQL error when the request was not authenticated.
func FromContext(ctx context.Context) (User, error) {
	user, ok := ctx.Value(contextKey{}).(User)
	if !ok {
		return User{}, fmt.Errorf("Authorization bearer token is required")
	}
	return user, nil
}

func UserFromRequest(r *http.Request) (User, error) {
	header := r.Header.Get("Authorization")
	token, ok := strings.CutPrefix(header, "Bearer ")
	if !ok || token == "" {
		return User{}, fmt.Errorf("Authorization bearer token is required")
	}
	return UserFromToken(token)
}

func UserFromToken(token string) (User, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return User{}, fmt.Errorf("token is not a JWT")
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return User{}, fmt.Errorf("decode token payload: %w", err)
	}

	var claims struct {
		Sub               string `json:"sub"`
		CognitoUsername   string `json:"cognito:username"`
		PreferredUsername string `json:"preferred_username"`
		Username          string `json:"username"`
		Email             string `json:"email"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return User{}, fmt.Errorf("parse token claims: %w", err)
	}
	if claims.Sub == "" {
		return User{}, fmt.Errorf("token has no sub claim")
	}

	name := firstNonEmpty(claims.CognitoUsername, claims.PreferredUsername, claims.Username, claims.Email)
	if name == "" {
		name = claims.Sub
	}
	return User{ID: claims.Sub, Name: name}, nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
