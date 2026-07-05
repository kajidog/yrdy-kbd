package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
)

const (
	kvsSigningAlgorithm = "AWS4-HMAC-SHA256"
	kvsSigningService   = "kinesisvideo"
	kvsSignedHeaders    = "host"
	kvsSignedTTLSeconds = "299"
	emptySHA256Hex      = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
)

func signKVSWebSocketURL(endpoint string, region string, creds aws.Credentials, queryParams map[string]string) (string, error) {
	return signKVSWebSocketURLAt(endpoint, region, creds, queryParams, time.Now().UTC())
}

func signKVSWebSocketURLAt(endpoint string, region string, creds aws.Credentials, queryParams map[string]string, now time.Time) (string, error) {
	if region == "" {
		return "", fmt.Errorf("region is required")
	}
	if creds.AccessKeyID == "" || creds.SecretAccessKey == "" {
		return "", fmt.Errorf("AWS credentials are incomplete")
	}

	parsed, err := url.Parse(endpoint)
	if err != nil {
		return "", fmt.Errorf("parse endpoint: %w", err)
	}
	if parsed.Scheme != "wss" {
		return "", fmt.Errorf("endpoint must use wss scheme")
	}
	if parsed.Host == "" {
		return "", fmt.Errorf("endpoint host is required")
	}
	if parsed.RawQuery != "" {
		return "", fmt.Errorf("endpoint must not include query parameters")
	}

	canonicalURI := parsed.EscapedPath()
	if canonicalURI == "" {
		canonicalURI = "/"
	}

	signingTime := now.UTC()
	amzDate := signingTime.Format("20060102T150405Z")
	date := signingTime.Format("20060102")
	scope := strings.Join([]string{date, region, kvsSigningService, "aws4_request"}, "/")

	params := make(map[string]string, len(queryParams)+6)
	for key, value := range queryParams {
		params[key] = value
	}
	params["X-Amz-Algorithm"] = kvsSigningAlgorithm
	params["X-Amz-Credential"] = creds.AccessKeyID + "/" + scope
	params["X-Amz-Date"] = amzDate
	params["X-Amz-Expires"] = kvsSignedTTLSeconds
	params["X-Amz-SignedHeaders"] = kvsSignedHeaders
	if creds.SessionToken != "" {
		params["X-Amz-Security-Token"] = creds.SessionToken
	}

	canonicalQuery := canonicalQueryString(params)
	canonicalHeaders := "host:" + parsed.Host + "\n"
	canonicalRequest := strings.Join([]string{
		"GET",
		canonicalURI,
		canonicalQuery,
		canonicalHeaders,
		kvsSignedHeaders,
		emptySHA256Hex,
	}, "\n")

	hashedRequest := sha256Hex([]byte(canonicalRequest))
	stringToSign := strings.Join([]string{
		kvsSigningAlgorithm,
		amzDate,
		scope,
		hashedRequest,
	}, "\n")

	signature := hex.EncodeToString(hmacSHA256(signingKey(creds.SecretAccessKey, date, region), []byte(stringToSign)))
	params["X-Amz-Signature"] = signature

	signed := *parsed
	signed.RawQuery = canonicalQueryString(params)
	return signed.String(), nil
}

func canonicalQueryString(values map[string]string) string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, awsPercentEncode(key)+"="+awsPercentEncode(values[key]))
	}
	return strings.Join(parts, "&")
}

func awsPercentEncode(value string) string {
	encoded := url.QueryEscape(value)
	encoded = strings.ReplaceAll(encoded, "+", "%20")
	encoded = strings.ReplaceAll(encoded, "%7E", "~")
	return encoded
}

func sha256Hex(value []byte) string {
	sum := sha256.Sum256(value)
	return hex.EncodeToString(sum[:])
}

func signingKey(secret, date, region string) []byte {
	kDate := hmacSHA256([]byte("AWS4"+secret), []byte(date))
	kRegion := hmacSHA256(kDate, []byte(region))
	kService := hmacSHA256(kRegion, []byte(kvsSigningService))
	return hmacSHA256(kService, []byte("aws4_request"))
}

func hmacSHA256(key, value []byte) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write(value)
	return mac.Sum(nil)
}
