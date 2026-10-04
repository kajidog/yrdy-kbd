// 使い方: EDGE_COGNITO_USER_POOL_ID=... node build.mjs
//        （ローカルなら node --env-file=.env.dev build.mjs）
// 出力: dist/<name>/index.mjs と dist/<name>.zip（Lambda@Edge にそのままデプロイできる形）
//
// Lambda@Edge は環境変数を使えないので、ソース中の process.env.EDGE_* をビルド時に値へ置き換える。
// 各環境のデプロイ前ビルド（CodeBuild 等）で環境変数を渡せば、その環境用のバンドルができる。
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";

const PREFIX = "EDGE_";
const VIEWER_LIMIT = 1024 * 1024; // viewer-request トリガーの zip 上限 1MB

// EDGE_* だけを埋め込む（それ以外の環境変数がバンドルに混ざらないように）
const define = Object.fromEntries(
  Object.entries(process.env)
    .filter(([k]) => k.startsWith(PREFIX))
    .map(([k, v]) => [`process.env.${k}`, JSON.stringify(v)]),
);

// src/handlers/*.ts がそのままビルド対象
const handlers = readdirSync("src/handlers")
  .filter((f) => f.endsWith(".ts"))
  .map((f) => f.slice(0, -3));

rmSync("dist", { recursive: true, force: true });

const errors = [];
for (const name of handlers) {
  const outfile = `dist/${name}/index.mjs`;
  await build({
    entryPoints: [`src/handlers/${name}.ts`],
    outfile,
    bundle: true,
    minify: true,
    sourcemap: false,
    platform: "node",
    target: "node22",
    format: "esm",
    external: ["@aws-sdk/*"], // ランタイム同梱
    define,
    logLevel: "warning",
  });

  // 置き換わらずに残った参照 = そのハンドラーが使っているのに渡されていない環境変数
  const missing = [...new Set(readFileSync(outfile, "utf8").match(/\bEDGE_[A-Z0-9_]+/g) ?? [])];
  if (missing.length) {
    errors.push(`${name}: 環境変数が未設定: ${missing.join(", ")}`);
    continue;
  }

  // 値の形式チェック（providers.ts のファクトリ）はモジュール読み込み時に走るので、ここで一度読み込む
  try {
    await import(pathToFileURL(outfile).href);
  } catch (e) {
    errors.push(`${name}: ${e.message}`);
    continue;
  }

  execFileSync("zip", ["-qj", `dist/${name}.zip`, outfile]);
  const size = statSync(`dist/${name}.zip`).size;
  if (size > VIEWER_LIMIT) errors.push(`${name}.zip is ${size} bytes (> 1MB)`);
  console.log(`${name}: dist/${name}.zip (${(size / 1024).toFixed(1)} KB)`);
}

if (errors.length) {
  rmSync("dist", { recursive: true, force: true });
  throw new Error(`build failed:\n  - ${errors.join("\n  - ")}`);
}
