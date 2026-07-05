package main

import (
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
)

func TestSignKVSWebSocketURLAt(t *testing.T) {
	signed, err := signKVSWebSocketURLAt(
		"wss://v-test.kinesisvideo.ap-northeast-1.amazonaws.com/",
		"ap-northeast-1",
		aws.Credentials{
			AccessKeyID:     "AKIDEXAMPLE",
			SecretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
			SessionToken:    "token/with+chars=",
		},
		map[string]string{
			"X-Amz-ChannelARN": "arn:aws:kinesisvideo:ap-northeast-1:123456789012:channel/demo/1",
			"X-Amz-ClientId":   "viewer-1",
		},
		time.Date(2026, 7, 5, 12, 0, 0, 0, time.UTC),
	)
	if err != nil {
		t.Fatalf("sign URL: %v", err)
	}

	parsed, err := url.Parse(signed)
	if err != nil {
		t.Fatalf("parse signed URL: %v", err)
	}
	query := parsed.Query()
	if parsed.Scheme != "wss" {
		t.Fatalf("scheme = %q, want wss", parsed.Scheme)
	}
	if query.Get("X-Amz-Algorithm") != kvsSigningAlgorithm {
		t.Fatalf("missing signing algorithm")
	}
	if query.Get("X-Amz-Date") != "20260705T120000Z" {
		t.Fatalf("unexpected signing date: %s", query.Get("X-Amz-Date"))
	}
	if query.Get("X-Amz-Signature") == "" {
		t.Fatalf("missing signature")
	}
	if !strings.Contains(signed, "X-Amz-Credential=AKIDEXAMPLE%2F20260705%2Fap-northeast-1%2Fkinesisvideo%2Faws4_request") {
		t.Fatalf("credential scope was not AWS percent encoded: %s", signed)
	}
}

func TestSignKVSWebSocketURLRejectsNonWSS(t *testing.T) {
	_, err := signKVSWebSocketURLAt(
		"https://v-test.kinesisvideo.ap-northeast-1.amazonaws.com/",
		"ap-northeast-1",
		aws.Credentials{AccessKeyID: "key", SecretAccessKey: "secret"},
		map[string]string{"X-Amz-ChannelARN": "arn"},
		time.Date(2026, 7, 5, 12, 0, 0, 0, time.UTC),
	)
	if err == nil {
		t.Fatal("expected non-wss endpoint to be rejected")
	}
}
