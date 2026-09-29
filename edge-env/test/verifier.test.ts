import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AcceptRule } from "../src/shared/providers";
import { createVerifier } from "../src/shared/verifier";

// --- 3 つの IdP（Cognito / Auth0 / Keycloak）風のトークンをローカル鍵で発行する ---
const b64url = (v: object) => Buffer.from(JSON.stringify(v)).toString("base64url");

const idp = (iss: string) => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = `kid-${iss}`;
  return {
    iss,
    jwks: { keys: [{ ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" }] } as never,
    issue: (claims: Record<string, unknown>) => {
      const now = Math.floor(Date.now() / 1000);
      const header = b64url({ alg: "RS256", kid, typ: "JWT" });
      const payload = b64url({ sub: "user-1", iss, iat: now, exp: now + 3600, ...claims });
      const sig = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
      return `${header}.${payload}.${sig}`;
    },
  };
};

const cognito = idp("https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_TEST");
const auth0 = idp("https://tenant.jp.auth0.com/");
const keycloak = idp("https://kc.example.com/realms/app");

const accept: AcceptRule[] = [
  {
    name: "cognito", kind: "cognito", issuer: cognito.iss,
    userPoolId: "ap-northeast-1_TEST", clientId: "cognito-client", tokenUse: "id",
  },
  {
    name: "auth0", kind: "jwt", issuer: auth0.iss,
    jwksUri: `${auth0.iss}.well-known/jwks.json`, audience: "https://api.example.com",
  },
  {
    name: "keycloak", kind: "jwt", issuer: keycloak.iss,
    jwksUri: `${keycloak.iss}/protocol/openid-connect/certs`, audience: null,
    claims: { azp: "cli" },
  },
];

const verifier = createVerifier(accept);
for (const p of [cognito, auth0, keycloak]) verifier.cacheJwks(p.iss, p.jwks);

describe("createVerifier", () => {
  it("accept に並べたどの IdP のトークンも通す", async () => {
    await expect(verifier.verify(cognito.issue({ aud: "cognito-client", token_use: "id" }))).resolves.toMatchObject({ iss: cognito.iss });
    await expect(verifier.verify(auth0.issue({ aud: ["https://api.example.com", "x"] }))).resolves.toMatchObject({ iss: auth0.iss });
    await expect(verifier.verify(keycloak.issue({ aud: "account", azp: "cli" }))).resolves.toMatchObject({ iss: keycloak.iss });
  });

  it("accept にない issuer は拒否", async () => {
    const other = idp("https://other.example.com/");
    await expect(verifier.verify(other.issue({ aud: "https://api.example.com" }))).rejects.toThrow(/not accepted/);
  });

  it("IdP ごとの条件（aud / tokenUse / claims）で絞る", async () => {
    await expect(verifier.verify(auth0.issue({ aud: "https://other-api" }))).rejects.toThrow();
    await expect(verifier.verify(cognito.issue({ aud: "cognito-client", token_use: "access" }))).rejects.toThrow();
    await expect(verifier.verify(keycloak.issue({ azp: "web" }))).rejects.toThrow(/azp/);
  });

  it("iss を別 IdP に書き換えても、その IdP の鍵で署名されていなければ拒否", async () => {
    // Keycloak の鍵で署名し、iss だけ Auth0 を名乗る
    const forged = keycloak.issue({ iss: auth0.iss, aud: "https://api.example.com" });
    await expect(verifier.verify(forged)).rejects.toThrow();
  });

  it("claims はクレームが配列ならいずれか一致で通す", async () => {
    const v = createVerifier([{ ...accept[1], claims: { permissions: ["read:all", "admin"] } } as AcceptRule]);
    v.cacheJwks(auth0.iss, auth0.jwks);
    await expect(v.verify(auth0.issue({ aud: "https://api.example.com", permissions: ["read:all"] }))).resolves.toBeTruthy();
    await expect(v.verify(auth0.issue({ aud: "https://api.example.com", permissions: ["write"] }))).rejects.toThrow();
  });
});
