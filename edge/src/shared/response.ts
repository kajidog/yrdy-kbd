import type { CloudFrontHeaders, CloudFrontResultResponse } from "aws-lambda";

export const unauthorized = (extraHeaders: CloudFrontHeaders = {}): CloudFrontResultResponse => ({
  status: "401",
  statusDescription: "Unauthorized",
  headers: {
    "content-type": [{ key: "Content-Type", value: "application/json" }],
    "www-authenticate": [{ key: "WWW-Authenticate", value: "Bearer" }],
    "cache-control": [{ key: "Cache-Control", value: "no-store" }],
    ...extraHeaders,
  },
  body: JSON.stringify({ message: "Unauthorized" }),
});
