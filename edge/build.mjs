// 使い方: STAGE=dev node build.mjs
// 出力: dist/<name>/index.mjs と dist/<name>.zip（Lambda@Edge にそのままデプロイできる形）
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { resolveConfig } from "./resolve-config.mjs";

// 既定値は持たない。本番ビルドで STAGE が抜けて dev の設定が埋め込まれるのを防ぐ
const stage = process.env.STAGE;
if (!stage) throw new Error("STAGE is required (e.g. STAGE=dev npm run build)");
const stageConfig = JSON.parse(readFileSync(`config/${stage}.json`, "utf8"));

// src/handlers/*.ts がそのままハンドラー一覧（config の handlers と 1:1 で対応させる）
const handlers = readdirSync("src/handlers")
  .filter((f) => f.endsWith(".ts"))
  .map((f) => f.slice(0, -3));

// プレースホルダーや形式違いのままパッケージしないよう、ビルド前に検証する
const { errors, handlers: handlerConfigs } = resolveConfig(stageConfig, handlers);
if (errors.length) {
  throw new Error(`config/${stage}.json:\n  - ${errors.join("\n  - ")}`);
}
const VIEWER_LIMIT = 1024 * 1024; // viewer-request トリガーの zip 上限 1MB

rmSync("dist", { recursive: true, force: true });

for (const name of handlers) {
  await build({
    entryPoints: [`src/handlers/${name}.ts`],
    outfile: `dist/${name}/index.mjs`,
    bundle: true,
    minify: true,
    sourcemap: false,
    platform: "node",
    target: "node22",
    format: "esm",
    external: ["@aws-sdk/*"], // ランタイム同梱
    define: {
      __EDGE_CONFIG__: JSON.stringify(handlerConfigs[name]),
    },
    logLevel: "warning",
  });

  execFileSync("zip", ["-qj", `dist/${name}.zip`, `dist/${name}/index.mjs`]);
  const size = statSync(`dist/${name}.zip`).size;
  if (size > VIEWER_LIMIT) throw new Error(`${name}.zip is ${size} bytes (> 1MB)`);
  const accepts = handlerConfigs[name].accept.map((r) => r.name).join(", ");
  console.log(`[${stage}] ${name}: dist/${name}.zip (${(size / 1024).toFixed(1)} KB) accept=[${accepts}]`);
}
