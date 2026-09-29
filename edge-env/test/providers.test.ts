import { describe, expect, it } from "vitest";
import { auth0, cognito, keycloak, list, oidc } from "../src/shared/providers";
import { createVerifier } from "../src/shared/verifier";

describe("providers", () => {
  it("IdP ごとに iss / JWKS を組み立てる", () => {
    expect(cognito({ userPoolId: "ap-northeast-1_AbC123", clientId: "a,b" })).toMatchObject({
      kind: "cognito",
      issuer: "https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_AbC123",
      clientId: ["a", "b"],
      tokenUse: "id",
    });
    expect(auth0({ domain: "tenant.jp.auth0.com", audience: "https://api.example.com" })).toMatchObject({
      issuer: "https://tenant.jp.auth0.com/",
      jwksUri: "https://tenant.jp.auth0.com/.well-known/jwks.json",
      audience: "https://api.example.com",
    });
    expect(keycloak({ issuer: "https://kc.example.com/realms/app/", audience: null, claims: { azp: "cli" } })).toMatchObject({
      issuer: "https://kc.example.com/realms/app",
      jwksUri: "https://kc.example.com/realms/app/protocol/openid-connect/certs",
      audience: null,
    });
    expect(oidc({ issuer: "https://idp.example.com", jwksUri: "https://idp.example.com/keys", audience: "x" })).toMatchObject({
      issuer: "https://idp.example.com",
      jwksUri: "https://idp.example.com/keys",
    });
  });

  it.each([
    ["空の userPoolId", () => cognito({ userPoolId: "", clientId: "a" }), /userPoolId is empty/],
    ["形式違いの userPoolId", () => cognito({ userPoolId: "pool", clientId: "a" }), /userPoolId is invalid/],
    ["空の clientId", () => cognito({ userPoolId: "ap-northeast-1_A", clientId: " , " }), /clientId is empty/],
    ["URL を渡した auth0.domain", () => auth0({ domain: "https://t.auth0.com/", audience: "x" }), /domain is invalid/],
    ["realms のない Keycloak issuer", () => keycloak({ issuer: "https://kc.example.com", audience: "x" }), /realms/],
    ["audience: null で claims なし", () => auth0({ domain: "t.auth0.com", audience: null }), /claims が必須/],
    ["空の claims 値", () => keycloak({ issuer: "https://kc.example.com/realms/a", audience: null, claims: { azp: "" } }), /claims.azp is empty/],
    ["https でない oidc", () => oidc({ issuer: "http://idp", jwksUri: "https://idp/keys", audience: "x" }), /https/],
  ])("%s は throw", (_, f, message) => {
    expect(f).toThrow(message);
  });

  it("同じ issuer を 2 回受け付けると throw", () => {
    const a = auth0({ domain: "t.auth0.com", audience: "x" });
    expect(() => createVerifier([a, a])).toThrow(/duplicate issuer/);
  });

  it("list はカンマ区切りを配列にし、空なら空配列", () => {
    expect(list("https://a.example.com, https://b.example.com")).toEqual(["https://a.example.com", "https://b.example.com"]);
    expect(list("")).toEqual([]);
  });
});
