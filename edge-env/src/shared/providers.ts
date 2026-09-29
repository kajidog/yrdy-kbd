// IdP ごとの「何を受け付けるか」を組み立てるファクトリ。
// 値はビルド時に環境変数から埋め込まれる（build.mjs）。形式違いはモジュール読み込み時に throw し、
// build.mjs がビルド直後にバンドルを読み込んで検出するので、壊れた値のままデプロイされない。

type Common = {
  /** scope クレームにいずれかが含まれていること */
  scope?: string | string[];
  /** 任意クレームの一致条件。値が配列ならいずれか一致（クレーム側が配列なら共通要素があれば可） */
  claims?: Record<string, string | string[]>;
};

type RuleCommon = Common & {
  /** ログ用 */
  name: string;
  /** JWT の iss。どのルールで検証するかはこの値で引く */
  issuer: string;
};

export type AcceptRule =
  | (RuleCommon & {
      kind: "cognito";
      userPoolId: string;
      clientId: string | string[];
      tokenUse: "id" | "access";
    })
  | (RuleCommon & {
      kind: "jwt";
      jwksUri: string;
      /** null は aud を検証しない（その場合 claims 必須） */
      audience: string | string[] | null;
    });

/** 環境変数由来の値（未設定なら build.mjs が止めるが、空文字はここで弾く） */
type Value = string | undefined;

const need = (label: string, v: Value): string => {
  if (!v) throw new Error(`${label} is empty`);
  return v;
};

/** "a,b" → ["a", "b"]。1 つなら文字列のまま */
const oneOrMany = (label: string, v: Value): string | string[] => {
  const list = need(label, v).split(",").map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) throw new Error(`${label} is empty`);
  return list.length === 1 ? list[0] : list;
};

/** CORS 等のカンマ区切りリスト。空文字なら空配列 */
export const list = (v: Value): string[] =>
  (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/** claims の値が空だと誰も通らない（または意図しない一致）ので弾く */
const checkClaims = (label: string, claims: Common["claims"]) => {
  for (const [k, v] of Object.entries(claims ?? {})) {
    const values = Array.isArray(v) ? v : [v];
    if (values.length === 0 || values.some((x) => !x)) throw new Error(`${label}.claims.${k} is empty`);
  }
  return claims;
};

const COGNITO_USER_POOL_ID = /^[a-z]{2}(-[a-z]+)+-\d_[0-9A-Za-z]+$/;

export const cognito = (o: Common & { userPoolId: Value; clientId: Value; tokenUse?: "id" | "access" }): AcceptRule => {
  const userPoolId = need("cognito.userPoolId", o.userPoolId);
  if (!COGNITO_USER_POOL_ID.test(userPoolId)) throw new Error(`cognito.userPoolId is invalid: ${userPoolId}`);
  const region = userPoolId.split("_")[0];
  return {
    name: "cognito",
    kind: "cognito",
    issuer: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`,
    userPoolId,
    clientId: oneOrMany("cognito.clientId", o.clientId),
    tokenUse: o.tokenUse ?? "id",
    scope: o.scope,
    claims: checkClaims("cognito", o.claims),
  };
};

/**
 * aud の条件。書き忘れで aud 検証が抜けないよう必須にし、見ない場合は null を明示する。
 * null のときは claims（例: azp）で絞ることを必須にする。
 */
const audience = (label: string, v: Value | null, claims: Common["claims"]) => {
  if (v === null) {
    if (!claims || Object.keys(claims).length === 0) throw new Error(`${label}: audience: null のときは claims が必須`);
    return null;
  }
  return oneOrMany(`${label}.audience`, v);
};

const jwt = (name: string, issuer: string, jwksUri: string, o: Common & { audience: Value | null }): AcceptRule => ({
  name,
  kind: "jwt",
  issuer,
  jwksUri,
  audience: audience(name, o.audience, o.claims),
  scope: o.scope,
  claims: checkClaims(name, o.claims),
});

/** domain: "tenant.jp.auth0.com"（カスタムドメインならそれ）。Auth0 の iss は末尾スラッシュ付き */
export const auth0 = (o: Common & { domain: Value; audience: Value | null }): AcceptRule => {
  const domain = need("auth0.domain", o.domain);
  if (!/^[a-z0-9.-]+$/i.test(domain)) throw new Error(`auth0.domain is invalid (例: tenant.jp.auth0.com): ${domain}`);
  return jwt("auth0", `https://${domain}/`, `https://${domain}/.well-known/jwks.json`, o);
};

/** issuer: "https://<host>/realms/<realm>"（Keycloak 17 未満は /auth/realms/<realm>） */
export const keycloak = (o: Common & { issuer: Value; audience: Value | null }): AcceptRule => {
  const issuer = need("keycloak.issuer", o.issuer).replace(/\/$/, "");
  if (!/^https:\/\/[^/\s]+(\/.*)?\/realms\/[^/]+$/.test(issuer)) {
    throw new Error(`keycloak.issuer must be https://<host>/realms/<realm>: ${issuer}`);
  }
  return jwt("keycloak", issuer, `${issuer}/protocol/openid-connect/certs`, o);
};

/** その他の OIDC プロバイダー。iss と JWKS の URL をそのまま指定する */
export const oidc = (o: Common & { name?: string; issuer: Value; jwksUri: Value; audience: Value | null }): AcceptRule => {
  const issuer = need("oidc.issuer", o.issuer);
  const jwksUri = need("oidc.jwksUri", o.jwksUri);
  if (!issuer.startsWith("https://")) throw new Error(`oidc.issuer must be https: ${issuer}`);
  if (!jwksUri.startsWith("https://")) throw new Error(`oidc.jwksUri must be https: ${jwksUri}`);
  return jwt(o.name ?? "oidc", issuer, jwksUri, o);
};
