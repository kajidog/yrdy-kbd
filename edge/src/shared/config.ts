// Lambda@Edge は環境変数を使えないため、設定はビルド時に esbuild の define で埋め込む。
// 値は config/<STAGE>.json を resolve-config.mjs で検証・変換したもの（ハンドラーごとに異なる）。

type RuleCommon = {
  /** config の providers のキー（ログ用） */
  name: string;
  /** JWT の iss。どのルールで検証するかはこの値で引く */
  issuer: string;
  /** scope クレームにいずれかが含まれていること */
  scope?: string | string[];
  /** 任意クレームの一致条件。値が配列ならいずれか一致（クレーム側が配列なら共通要素があれば可） */
  claims?: Record<string, string | string[]>;
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

export type EdgeConfig = {
  /** このハンドラーが受け付けるトークンの発行元と条件 */
  accept: AcceptRule[];
  /** Edge が返す 401 に CORS ヘッダーを付けるオリジン */
  corsOrigins: string[];
};

declare const __EDGE_CONFIG__: EdgeConfig;

export const config: EdgeConfig = __EDGE_CONFIG__;
