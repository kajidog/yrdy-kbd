// config/<STAGE>.json を検証し、ハンドラーごとの実行時設定（src/shared/config.ts の EdgeConfig）に変換する。
// build.mjs から使うほか、test/ からも直接テストする。
//
// providers: IdP の定義（どこが発行したトークンか）。ハンドラーから参照されたものだけ検証・埋め込みする。
// handlers.<name>.accept: そのハンドラーが受け付ける IdP と、IdP ごとの検証条件。

const COGNITO_USER_POOL_ID = /^[a-z]{2}(-[a-z]+)+-\d_[0-9A-Za-z]+$/;
const PLACEHOLDER = "REPLACE_ME";

const isHttpsUrl = (v) => typeof v === "string" && /^https:\/\/[^\s/]+/.test(v);
const isStringOrList = (v) =>
  (typeof v === "string" && v !== "") ||
  (Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === "string" && s !== ""));

const isHttpsOrLocalOrigin = (v) =>
  typeof v === "string" && /^(https:\/\/[^/\s]+|http:\/\/localhost(:\d+)?)$/.test(v);

const hasPlaceholder = (v) =>
  v === PLACEHOLDER ||
  (Array.isArray(v) && v.some(hasPlaceholder)) ||
  (v !== null && typeof v === "object" && Object.values(v).some(hasPlaceholder));

/** プロバイダー定義 → { issuer, jwksUri }（Cognito は userPoolId も） */
const resolveProvider = (name, p, errors) => {
  const err = (msg) => errors.push(`providers.${name}: ${msg}`);
  if (!p || typeof p !== "object") return err("is not defined"), undefined;
  if (hasPlaceholder(p)) return err(`${PLACEHOLDER} が残っている`), undefined;

  switch (p.type) {
    case "cognito": {
      if (!COGNITO_USER_POOL_ID.test(p.userPoolId ?? "")) {
        return err(`userPoolId is invalid: ${JSON.stringify(p.userPoolId)}`), undefined;
      }
      const region = p.userPoolId.split("_")[0];
      return {
        type: "cognito",
        userPoolId: p.userPoolId,
        issuer: `https://cognito-idp.${region}.amazonaws.com/${p.userPoolId}`,
      };
    }
    case "auth0": {
      // Auth0 の iss は末尾スラッシュ付き。書き間違いで全件 401 にならないよう domain から組み立てる
      const domain = p.domain ?? "";
      if (!/^[a-z0-9.-]+$/i.test(domain)) {
        return err(`domain is invalid (例: "tenant.jp.auth0.com"): ${JSON.stringify(p.domain)}`), undefined;
      }
      return {
        type: "jwt",
        issuer: `https://${domain}/`,
        jwksUri: `https://${domain}/.well-known/jwks.json`,
      };
    }
    case "keycloak": {
      // 例: https://kc.example.com/realms/app（Keycloak 17 未満は /auth/realms/app）
      if (!isHttpsUrl(p.issuer) || !/\/realms\/[^/]+\/?$/.test(p.issuer)) {
        return err(`issuer must be "https://<host>/realms/<realm>": ${JSON.stringify(p.issuer)}`), undefined;
      }
      const issuer = p.issuer.replace(/\/$/, "");
      return { type: "jwt", issuer, jwksUri: `${issuer}/protocol/openid-connect/certs` };
    }
    case "oidc": {
      // その他の OIDC プロバイダー。iss と JWKS の URL をそのまま書く
      if (!isHttpsUrl(p.issuer)) return err(`issuer must be an https URL: ${JSON.stringify(p.issuer)}`), undefined;
      if (!isHttpsUrl(p.jwksUri)) return err(`jwksUri must be an https URL: ${JSON.stringify(p.jwksUri)}`), undefined;
      return { type: "jwt", issuer: p.issuer, jwksUri: p.jwksUri };
    }
    default:
      return err(`type must be one of cognito / auth0 / keycloak / oidc: ${JSON.stringify(p.type)}`), undefined;
  }
};

/** accept の 1 エントリ（そのプロバイダーから何を受け付けるか）を検証する */
const resolveRule = (where, provider, rule, errors) => {
  const err = (msg) => errors.push(`${where}: ${msg}`);
  if (!rule || typeof rule !== "object") return err("must be an object"), undefined;
  if (hasPlaceholder(rule)) return err(`${PLACEHOLDER} が残っている`), undefined;

  const { scope, claims } = rule;
  if (scope !== undefined && !isStringOrList(scope)) err("scope must be a string or string[]");
  if (claims !== undefined) {
    const ok =
      claims !== null &&
      typeof claims === "object" &&
      !Array.isArray(claims) &&
      Object.values(claims).every(isStringOrList);
    if (!ok) err('claims must be { "<claim>": string | string[] }');
  }
  const common = {
    ...(scope !== undefined && { scope }),
    ...(claims !== undefined && { claims }),
  };

  if (provider.type === "cognito") {
    if (!isStringOrList(rule.clientId)) err("clientId is required");
    const tokenUse = rule.tokenUse ?? "id";
    if (tokenUse !== "id" && tokenUse !== "access") err(`tokenUse must be "id" or "access"`);
    return {
      kind: "cognito",
      issuer: provider.issuer,
      userPoolId: provider.userPoolId,
      clientId: rule.clientId,
      tokenUse,
      ...common,
    };
  }

  // audience の書き忘れで aud 検証が抜けないよう、明示を必須にする（null は「aud を見ない」）
  if (!("audience" in rule)) {
    err('audience is required (aud を検証しない場合は null を明示し、claims で azp 等を絞る)');
  } else if (rule.audience === null) {
    if (!claims || Object.keys(claims).length === 0) {
      err("audience: null のときは claims（例: azp）の指定が必須");
    }
  } else if (!isStringOrList(rule.audience)) {
    err("audience must be a string, string[] or null");
  }
  return {
    kind: "jwt",
    issuer: provider.issuer,
    jwksUri: provider.jwksUri,
    audience: rule.audience,
    ...common,
  };
};

/**
 * @param {any} stageConfig config/<STAGE>.json の中身
 * @param {string[]} handlerNames src/handlers にあるハンドラー名
 * @returns {{ errors: string[], handlers: Record<string, import("./src/shared/config").EdgeConfig> }}
 */
export const resolveConfig = (stageConfig, handlerNames) => {
  const errors = [];
  const providers = stageConfig?.providers ?? {};
  const handlerConfigs = stageConfig?.handlers ?? {};
  const defaultCors = stageConfig?.corsOrigins ?? [];
  const resolvedProviders = new Map();
  const handlers = {};

  for (const name of Object.keys(handlerConfigs)) {
    if (!handlerNames.includes(name)) errors.push(`handlers.${name}: src/handlers/${name}.ts がない`);
  }

  for (const name of handlerNames) {
    const h = handlerConfigs[name];
    const accept = h?.accept;
    if (!accept || typeof accept !== "object" || Object.keys(accept).length === 0) {
      errors.push(`handlers.${name}.accept: 受け付けるプロバイダーを 1 つ以上指定する`);
      continue;
    }

    const rules = [];
    for (const [providerName, rule] of Object.entries(accept)) {
      if (!(providerName in providers)) {
        errors.push(`handlers.${name}.accept.${providerName}: providers に定義がない`);
        continue;
      }
      if (!resolvedProviders.has(providerName)) {
        resolvedProviders.set(providerName, resolveProvider(providerName, providers[providerName], errors));
      }
      const provider = resolvedProviders.get(providerName);
      if (!provider) continue;
      const resolved = resolveRule(`handlers.${name}.accept.${providerName}`, provider, rule, errors);
      if (resolved) rules.push({ name: providerName, ...resolved });
    }

    // 実行時は iss でルールを引くので、同じ issuer が 2 つあるとどちらを使うか決まらない
    const seen = new Map();
    for (const r of rules) {
      if (seen.has(r.issuer)) {
        errors.push(`handlers.${name}.accept: ${seen.get(r.issuer)} と ${r.name} の issuer が同じ（${r.issuer}）`);
      }
      seen.set(r.issuer, r.name);
    }

    const corsOrigins = h.corsOrigins ?? defaultCors;
    if (!Array.isArray(corsOrigins) || !corsOrigins.every(isHttpsOrLocalOrigin)) {
      errors.push(`handlers.${name}.corsOrigins must be a list of origins (例: "https://app.example.com")`);
    }

    handlers[name] = { accept: rules, corsOrigins };
  }

  return { errors, handlers };
};
