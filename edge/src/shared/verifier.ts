import { CognitoJwtVerifier, JwtVerifier } from "aws-jwt-verify";
import type { Jwks } from "aws-jwt-verify/jwk";
import { decomposeUnverifiedJwt } from "aws-jwt-verify/jwt";
import type { JwtPayload } from "aws-jwt-verify/jwt-model";
import type { Claims } from "./auth";
import type { AcceptRule } from "./config";

type SingleVerifier = {
  verify(token: string): Promise<unknown>;
  cacheJwks(jwks: Jwks): void;
};

const checkClaims =
  (expected: Record<string, string | string[]> | undefined) =>
  ({ payload }: { payload: JwtPayload }) => {
    for (const [claim, want] of Object.entries(expected ?? {})) {
      const allowed = Array.isArray(want) ? want : [want];
      const actual = payload[claim];
      const values = Array.isArray(actual) ? actual : [actual];
      if (!values.some((v) => typeof v === "string" && allowed.includes(v))) {
        throw new Error(`claim "${claim}" does not match`);
      }
    }
  };

const createSingle = (rule: AcceptRule): SingleVerifier => {
  const customJwtCheck = checkClaims(rule.claims);
  if (rule.kind === "cognito") {
    const v = CognitoJwtVerifier.create({
      userPoolId: rule.userPoolId,
      clientId: rule.clientId,
      tokenUse: rule.tokenUse,
      scope: rule.scope,
      customJwtCheck,
    });
    return { verify: (t) => v.verify(t), cacheJwks: (jwks) => v.cacheJwks(jwks) };
  }
  const v = JwtVerifier.create({
    issuer: rule.issuer,
    jwksUri: rule.jwksUri,
    audience: rule.audience,
    scope: rule.scope,
    customJwtCheck,
  });
  return { verify: (t) => v.verify(t), cacheJwks: (jwks) => v.cacheJwks(jwks) };
};

/**
 * accept に並べた発行元のいずれかが発行したトークンを受け付ける verifier。
 * 未検証の iss で担当ルールを選び、そのルールで署名・iss・aud 等をすべて検証する。
 *
 * ハンドラーのモジュールスコープで1回だけ生成する。
 * JWKS はインスタンス内にキャッシュされ、コンテナ再利用時は再取得されない。
 */
export const createVerifier = (accept: AcceptRule[]) => {
  const byIssuer = new Map(accept.map((rule) => [rule.issuer, createSingle(rule)]));

  return {
    async verify(token: string): Promise<Claims> {
      const { payload } = decomposeUnverifiedJwt(token);
      const verifier = typeof payload.iss === "string" ? byIssuer.get(payload.iss) : undefined;
      if (!verifier) throw new Error(`issuer is not accepted: ${String(payload.iss)}`);
      return (await verifier.verify(token)) as Claims;
    },
    /** テストやウォームアップ用に JWKS を事前投入する */
    cacheJwks(issuer: string, jwks: Jwks) {
      const verifier = byIssuer.get(issuer);
      if (!verifier) throw new Error(`issuer is not accepted: ${issuer}`);
      verifier.cacheJwks(jwks);
    },
  };
};
