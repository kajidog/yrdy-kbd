import { describe, expect, it } from "vitest";
import { resolveConfig } from "../resolve-config.mjs";

const providers = {
  cognito: { type: "cognito", userPoolId: "ap-northeast-1_AbC123" },
  auth0: { type: "auth0", domain: "tenant.jp.auth0.com" },
  keycloak: { type: "keycloak", issuer: "https://kc.example.com/realms/app/" },
  other: { type: "oidc", issuer: "https://idp.example.com", jwksUri: "https://idp.example.com/keys" },
  unused: { type: "auth0", domain: "REPLACE_ME" },
};

describe("resolveConfig", () => {
  it("ハンドラーごとに参照した IdP だけを実行時設定に展開する", () => {
    const { errors, handlers } = resolveConfig(
      {
        providers,
        handlers: {
          a: { accept: { cognito: { clientId: "c1" } } },
          b: {
            accept: {
              auth0: { audience: "https://api.example.com", scope: "read" },
              keycloak: { audience: null, claims: { azp: "cli" } },
              other: { audience: "x" },
            },
            corsOrigins: ["https://app.example.com"],
          },
        },
        corsOrigins: ["http://localhost:5173"],
      },
      ["a", "b"],
    );
    expect(errors).toEqual([]);
    expect(handlers.a).toEqual({
      accept: [{
        name: "cognito", kind: "cognito",
        issuer: "https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_AbC123",
        userPoolId: "ap-northeast-1_AbC123", clientId: "c1", tokenUse: "id",
      }],
      corsOrigins: ["http://localhost:5173"],
    });
    expect(handlers.b.accept).toEqual([
      {
        name: "auth0", kind: "jwt", issuer: "https://tenant.jp.auth0.com/",
        jwksUri: "https://tenant.jp.auth0.com/.well-known/jwks.json",
        audience: "https://api.example.com", scope: "read",
      },
      {
        name: "keycloak", kind: "jwt", issuer: "https://kc.example.com/realms/app",
        jwksUri: "https://kc.example.com/realms/app/protocol/openid-connect/certs",
        audience: null, claims: { azp: "cli" },
      },
      {
        name: "other", kind: "jwt", issuer: "https://idp.example.com",
        jwksUri: "https://idp.example.com/keys", audience: "x",
      },
    ]);
    expect(handlers.b.corsOrigins).toEqual(["https://app.example.com"]);
  });

  it.each([
    ["プレースホルダー", { cognito: { clientId: "REPLACE_ME" } }, /REPLACE_ME/],
    ["未定義のプロバイダー", { nope: { audience: "x" } }, /providers に定義がない/],
    ["audience の書き忘れ", { auth0: {} }, /audience is required/],
    ["audience: null で claims なし", { auth0: { audience: null } }, /claims/],
    ["Cognito の clientId なし", { cognito: {} }, /clientId is required/],
    ["空の accept", {}, /1 つ以上/],
  ])("%s はエラー", (_, accept, message) => {
    const { errors } = resolveConfig({ providers, handlers: { a: { accept } } }, ["a"]);
    expect(errors.join("\n")).toMatch(message);
  });

  it("config にないハンドラー・ファイルのないハンドラーはエラー", () => {
    const { errors } = resolveConfig(
      { providers, handlers: { ghost: { accept: { cognito: { clientId: "c" } } } } },
      ["a"],
    );
    expect(errors.join("\n")).toMatch(/handlers.ghost: src\/handlers\/ghost.ts がない/);
    expect(errors.join("\n")).toMatch(/handlers.a.accept/);
  });

  it("同じ issuer を 2 回受け付けるとエラー", () => {
    const { errors } = resolveConfig(
      {
        providers: { ...providers, auth0b: { type: "auth0", domain: "tenant.jp.auth0.com" } },
        handlers: { a: { accept: { auth0: { audience: "x" }, auth0b: { audience: "y" } } } },
      },
      ["a"],
    );
    expect(errors.join("\n")).toMatch(/issuer が同じ/);
  });
});
