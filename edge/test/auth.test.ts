import { generateKeyPairSync, sign } from "node:crypto";
import type { CloudFrontRequest, CloudFrontRequestEvent } from "aws-lambda";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { describe, expect, it } from "vitest";
import { createAuthHandler, forwardSub } from "../src/shared/auth";

// --- テスト用に Cognito 風の ID トークンをローカルで発行する ---
const userPoolId = "ap-northeast-1_TEST";
const clientId = "test-client";
const iss = `https://cognito-idp.ap-northeast-1.amazonaws.com/${userPoolId}`;
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const kid = "test-kid";

const b64url = (v: object) => Buffer.from(JSON.stringify(v)).toString("base64url");
const issueToken = (overrides: Record<string, unknown> = {}) => {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: "RS256", kid, typ: "JWT" });
  const payload = b64url({
    sub: "user-123", iss, aud: clientId, token_use: "id",
    iat: now, exp: now + 3600, ...overrides,
  });
  const sig = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
  return `${header}.${payload}.${sig}`;
};

const verifier = CognitoJwtVerifier.create({ userPoolId, clientId, tokenUse: "id" });
verifier.cacheJwks({ keys: [{ ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" } as never] });

const event = (req: Partial<CloudFrontRequest>): CloudFrontRequestEvent =>
  ({
    Records: [{ cf: { request: { method: "GET", uri: "/api", querystring: "", headers: {}, clientIp: "1.1.1.1", ...req } } }],
  }) as unknown as CloudFrontRequestEvent;

const bearer = (token: string) => ({ authorization: [{ key: "Authorization", value: `Bearer ${token}` }] });

describe("createAuthHandler", () => {
  const handler = createAuthHandler(verifier, { publicPaths: ["/health"], onAuthorized: forwardSub() });

  it("有効なトークンはリクエストを通し、sub をオリジンに渡す", async () => {
    const res = (await handler(event({ headers: bearer(issueToken()) }))) as CloudFrontRequest;
    expect(res.uri).toBe("/api");
    expect(res.headers["x-user-sub"][0].value).toBe("user-123");
  });

  it("ヘッダーなしは 401", async () => {
    expect(await handler(event({}))).toMatchObject({ status: "401" });
  });

  it("期限切れは 401", async () => {
    const token = issueToken({ exp: Math.floor(Date.now() / 1000) - 10 });
    expect(await handler(event({ headers: bearer(token) }))).toMatchObject({ status: "401" });
  });

  it("別クライアント向けのトークンは 401", async () => {
    const token = issueToken({ aud: "other-client" });
    expect(await handler(event({ headers: bearer(token) }))).toMatchObject({ status: "401" });
  });

  it("access トークンは 401（ID トークンのみ許可）", async () => {
    const token = issueToken({ token_use: "access" });
    expect(await handler(event({ headers: bearer(token) }))).toMatchObject({ status: "401" });
  });

  it("改ざんされたトークンは 401", async () => {
    const [h, , s] = issueToken().split(".");
    const forged = `${h}.${b64url({ sub: "admin", iss, aud: clientId, token_use: "id", exp: 9999999999 })}.${s}`;
    expect(await handler(event({ headers: bearer(forged) }))).toMatchObject({ status: "401" });
  });

  it("publicPaths と OPTIONS は認証なしで通す", async () => {
    expect(await handler(event({ uri: "/health" }))).toMatchObject({ uri: "/health" });
    expect(await handler(event({ method: "OPTIONS" }))).toMatchObject({ method: "OPTIONS" });
  });
});
