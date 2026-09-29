// Lambda@Edge は環境変数を使えないため、設定はビルド時に esbuild の define で埋め込む。
// 値は config/<STAGE>.json から build.mjs が注入する。
export type EdgeConfig = {
  userPoolId: string;
  clientId: string;
};

declare const __EDGE_CONFIG__: EdgeConfig;

export const config: EdgeConfig = __EDGE_CONFIG__;
