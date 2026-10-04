# edge-auth-env

CloudFront + Lambda@Edge で JWT を検証するハンドラー群（環境変数埋め込み版）。
`edge/` との違いは設定の持ち方だけで、検証ロジックは同じ。

- **何を受け付けるか**（どの IdP の、どの条件のトークンか）は `src/handlers/<name>.ts` に直接書く
- **値**（userPoolId、clientId、Auth0 のドメインなど）は各環境のデプロイ前ビルドで環境変数 `EDGE_*` から埋め込む

Cognito / Auth0 / Keycloak / その他 OIDC に対応し、1 つのハンドラーで複数の IdP を受け付けられる。

```
src/
  shared/
    providers.ts   # cognito() / auth0() / keycloak() / oidc(): IdP ごとの受け付け条件を組み立てる
    verifier.ts    # 複数 IdP 対応の verifier（iss で担当を選ぶ。モジュールスコープでJWKSキャッシュ）
    auth.ts        # createAuthHandler: ヘッダー取得 → JWT検証 → 通す/401
    response.ts    # 401 レスポンス
  handlers/
    mobi.ts        # Cognito の ID トークン
    pc.ts          # Cognito の ID トークン + Auth0 のアクセストークン
    cli-api.ts     # Keycloak のアクセストークン（azp で絞る）
test/
build.mjs          # process.env.EDGE_* を値に置き換えて dist/<name>.zip を生成
buildspec.yml      # CodeBuild 用
.env.example       # 使う環境変数の一覧
```

## ハンドラーの書き方

```ts
export const handler = createAuthHandler(
  createVerifier([
    cognito({
      userPoolId: process.env.EDGE_COGNITO_USER_POOL_ID,
      clientId: process.env.EDGE_PC_COGNITO_CLIENT_ID, // カンマ区切りで複数可
      tokenUse: "id",
    }),
    auth0({
      domain: process.env.EDGE_AUTH0_DOMAIN,
      audience: process.env.EDGE_AUTH0_AUDIENCE,
      scope: "read:data",
    }),
  ]),
  { corsOrigins: list(process.env.EDGE_CORS_ORIGINS), onAuthorized: forwardClaims() },
);
```

環境変数名は自由に付けてよい（`EDGE_` で始まっていれば埋め込まれる）。環境で変わらない値は直接書いてもよい。

| ファクトリ | 必須 | iss / JWKS |
| --- | --- | --- |
| `cognito` | `userPoolId`, `clientId` | `https://cognito-idp.<region>.amazonaws.com/<userPoolId>` |
| `auth0` | `domain`, `audience` | `https://<domain>/`（末尾スラッシュ付き）/ `.well-known/jwks.json` |
| `keycloak` | `issuer`（`https://<host>/realms/<realm>`）, `audience` | `<issuer>/protocol/openid-connect/certs` |
| `oidc` | `issuer`, `jwksUri`, `audience` | 指定値そのまま |

共通オプション:

- `scope`: `scope` にいずれかが含まれること
- `claims`: 任意クレームの一致。例: `{ azp: "cli" }`, `{ "cognito:groups": "admin" }`
  - 値が配列ならどれか 1 つと一致すればよい
  - クレーム側が配列なら、共通要素が 1 つあれば通す
- `audience: null` で `aud` を検証しない。その場合 `claims` の指定が必須
  - Keycloak のアクセストークンは `aud` が既定で `account` になりがち。`azp` で絞る

`forwardClaims()` はオリジンに `x-user-sub` と `x-user-iss` を渡す。`sub` は IdP 間で一意とは限らないので、
オリジン側は `(iss, sub)` の組でユーザーを識別する。

## コマンド

```sh
npm ci
npm run typecheck
npm test
cp .env.example .env.dev   # 値を埋める
node --env-file=.env.dev build.mjs   # → dist/mobi.zip, dist/pc.zip, dist/cli-api.zip
```

CI では環境ごとの CodeBuild プロジェクトに `EDGE_*` を設定して `npm run build` する（buildspec.yml 参照）。

## ビルド時のチェック

- ハンドラーが参照している `EDGE_*` が 1 つでも未設定 → 失敗（どの変数が足りないかを表示）
  - 空で良い変数（`EDGE_CORS_ORIGINS` など）も、空文字で設定はする
- 値の形式違い（userPoolId、ドメイン、issuer 等）や、`audience` と `claims` の条件違反 → 失敗
  - build.mjs がビルド直後にバンドルを読み込み、ファクトリ関数のチェックを走らせる
- zip が 1MB（viewer-request の上限）を超えた → 失敗

## 注意

- Lambda@Edge は環境変数不可。`process.env.EDGE_*` は実行時には読まれず、ビルド時に文字列に置き換わる。
  - 環境ごとに別ビルドになる
  - バンドルに埋め込まれるのは `EDGE_*` だけ
  - client secret などの秘密情報は入れない。Edge での検証には不要
- JWKS は各 IdP から実行時に取得する。Edge から各 IdP の JWKS エンドポイントに到達できる必要がある。
- ランタイムは Node.js 22（`.mjs` / ESM）。関数は us-east-1 に作成。
