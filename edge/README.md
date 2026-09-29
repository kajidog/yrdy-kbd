# edge-auth

CloudFront + Lambda@Edge で JWT を検証するハンドラー群。
Cognito / Auth0 / Keycloak / その他 OIDC のトークンを、ハンドラーごとに「どの IdP の、どの条件のものを通すか」を選んで検証できる。
共通ロジックは `src/shared/`、各ハンドラーは設定を渡すだけ。

```
src/
  shared/
    auth.ts        # createAuthHandler: ヘッダー取得 → JWT検証 → 通す/401
    verifier.ts    # 複数 IdP 対応の verifier（iss で担当を選ぶ。モジュールスコープでJWKSキャッシュ）
    config.ts      # ビルド時に埋め込まれる設定（ハンドラーごと）
    response.ts    # 401 レスポンス
  handlers/
    mobi.ts / pc.ts / cli-api.ts
config/
  dev.json / prd.json   # providers / handlers / corsOrigins（REPLACE_ME を実値に置き換える）
test/                   # ローカル鍵で発行したJWTで検証ロジックをテスト
resolve-config.mjs      # config の検証と、ハンドラーごとの実行時設定への変換
build.mjs               # esbuild で dist/<name>/index.mjs と dist/<name>.zip を生成
buildspec.yml           # CodeBuild 用
```

## コマンド

```sh
npm ci
npm run typecheck
npm test
STAGE=dev npm run build   # → dist/mobi.zip, dist/pc.zip, dist/cli-api.zip
```

## 設定（config/<STAGE>.json）

`providers` に IdP を定義し、`handlers.<name>.accept` で「どの IdP から、何を条件に受け付けるか」を選ぶ。
ハンドラーから参照されていない provider は検証も埋め込みもされない（使わない IdP は書かなくてよい）。

```json
{
  "providers": {
    "cognito":  { "type": "cognito",  "userPoolId": "ap-northeast-1_XXXXXXXXX" },
    "auth0":    { "type": "auth0",    "domain": "tenant.jp.auth0.com" },
    "keycloak": { "type": "keycloak", "issuer": "https://kc.example.com/realms/app" },
    "other":    { "type": "oidc",     "issuer": "https://idp.example.com", "jwksUri": "https://idp.example.com/keys" }
  },
  "handlers": {
    "mobi":    { "accept": { "cognito": { "clientId": "xxxx", "tokenUse": "id" } } },
    "pc": {
      "accept": {
        "cognito": { "clientId": "yyyy" },
        "auth0":   { "audience": "https://api.example.com", "scope": "read:data" }
      },
      "corsOrigins": ["https://app.example.com"]
    },
    "cli-api": {
      "accept": { "keycloak": { "audience": null, "claims": { "azp": "cli" } } }
    }
  },
  "corsOrigins": []
}
```

### providers

| type | 必須 | 導出される iss / JWKS |
| --- | --- | --- |
| `cognito` | `userPoolId` | `https://cognito-idp.<region>.amazonaws.com/<userPoolId>` |
| `auth0` | `domain`（カスタムドメインならそれ） | `https://<domain>/`（末尾スラッシュ付き）/ `.well-known/jwks.json` |
| `keycloak` | `issuer`（`https://<host>/realms/<realm>`） | `<issuer>/protocol/openid-connect/certs` |
| `oidc` | `issuer`, `jwksUri` | 書いた値をそのまま使う |

### accept の条件

| キー | 対象 | 意味 |
| --- | --- | --- |
| `clientId` | cognito（必須） | ID トークンは `aud`、アクセストークンは `client_id` を検証。配列可 |
| `tokenUse` | cognito | `"id"`（既定）/ `"access"` |
| `audience` | cognito 以外（必須） | `aud` にいずれかが含まれること。`null` で aud を見ない（その場合 `claims` 必須） |
| `scope` | 共通 | `scope` にいずれかが含まれること |
| `claims` | 共通 | 任意クレームの一致（値が配列ならいずれか一致、クレームが配列なら共通要素があれば可）。例: `{"azp": "cli"}`, `{"cognito:groups": "admin"}` |

- Auth0: アクセストークンなら `audience` に API の Identifier、ID トークンなら Client ID。
- Keycloak: アクセストークンの `aud` は既定で `account` になりがち。クライアントに Audience マッパーを付けて `audience` で絞るか、`audience: null` + `claims.azp` でクライアントを絞る。
- 1 つのハンドラーで同じ issuer を 2 回受け付けることはできない（ビルドエラー）。

### オリジンに渡すヘッダー

`forwardClaims()` は `x-user-sub` と `x-user-iss` を付ける。`sub` は IdP 間で一意とは限らないので、
オリジン側は `(iss, sub)` の組でユーザーを識別する。別のクレームを渡したい場合は
`forwardClaims({ sub: "x-user-sub", email: "x-user-email" })` のように指定する。

## ハンドラーを追加するとき

1. `src/handlers/<name>.ts` を作る（`src/handlers/*.ts` がそのままビルド対象）
2. `config/*.json` の `handlers` に `<name>` と `accept` を追加

## 注意

- Lambda@Edge は環境変数不可 → 設定はビルド時に `define` で埋め込む。ステージごとに別ビルド。
- ランタイムは Node.js 22（`.mjs` / ESM）。関数は us-east-1 に作成。
- 1MB（viewer-request）を超えたら build.mjs が失敗する。
- 使っている provider / accept に `REPLACE_ME` が残っている、形式が不正、`audience` の書き忘れ等があればビルドが失敗する。
- JWKS は各 IdP から実行時に取得する（Edge から IdP の JWKS エンドポイントへ到達できる必要がある）。
- ブラウザから呼ぶ場合は `corsOrigins` にフロントのオリジンを入れる（Edge が返す 401 にも CORS ヘッダーが付く）。
- CodeBuild はリポジトリルートで動くので、プロジェクトの buildspec パスに `edge/buildspec.yml` を指定する。
