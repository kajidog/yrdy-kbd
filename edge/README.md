# edge-auth

CloudFront + Lambda@Edge で Cognito の ID トークンを検証するハンドラー群。
共通ロジックは `src/shared/`、各ハンドラーは設定を渡すだけ。

```
src/
  shared/
    auth.ts        # createAuthHandler: ヘッダー取得 → JWT検証 → 通す/401
    verifier.ts    # CognitoJwtVerifier の生成（モジュールスコープでJWKSキャッシュ）
    config.ts      # ビルド時に埋め込まれる設定
    response.ts    # 401 レスポンス
  handlers/
    mobi.ts / pc.ts / cli-api.ts
config/
  dev.json / prd.json   # userPoolId と ハンドラーごとの clientId
test/                   # ローカル鍵で発行したJWTで検証ロジックをテスト
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

## ハンドラーを追加するとき

1. `src/handlers/<name>.ts` を作る
2. `config/*.json` の `clientIds` に `<name>` を追加
3. `build.mjs` の `handlers` 配列に追加

## 注意

- Lambda@Edge は環境変数不可 → 設定はビルド時に `define` で埋め込む。ステージごとに別ビルド。
- ランタイムは Node.js 22（`.mjs` / ESM）。関数は us-east-1 に作成。
- 1MB（viewer-request）を超えたら build.mjs が失敗する。
