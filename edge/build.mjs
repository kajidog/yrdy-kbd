// 使い方: STAGE=dev node build.mjs
// 出力: dist/<name>/index.mjs と dist/<name>.zip（Lambda@Edge にそのままデプロイできる形）
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, statSync } from "node:fs";

const stage = process.env.STAGE ?? "dev";
const stageConfig = JSON.parse(readFileSync(`config/${stage}.json`, "utf8"));

const handlers = ["mobi", "pc", "cli-api"];

// プレースホルダーや形式違いのままパッケージしないよう、ビルド前に検証する
const USER_POOL_ID = /^[a-z]{2}(-[a-z]+)+-\d_[0-9A-Za-z]+$/;
const errors = [];
if (!USER_POOL_ID.test(stageConfig.userPoolId ?? "")) {
  errors.push(`userPoolId is invalid: ${JSON.stringify(stageConfig.userPoolId)}`);
}
for (const name of handlers) {
  const id = stageConfig.clientIds?.[name];
  if (!id || id === "REPLACE_ME") errors.push(`clientIds.${name} is not set`);
}
if (errors.length) {
  throw new Error(`config/${stage}.json:\n  - ${errors.join("\n  - ")}`);
}
const VIEWER_LIMIT = 1024 * 1024; // viewer-request トリガーの zip 上限 1MB

rmSync("dist", { recursive: true, force: true });

for (const name of handlers) {
  const clientId = stageConfig.clientIds[name];
  const corsOrigins = stageConfig.corsOrigins ?? [];

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
      __EDGE_CONFIG__: JSON.stringify({ userPoolId: stageConfig.userPoolId, clientId, corsOrigins }),
    },
    logLevel: "warning",
  });

  execFileSync("zip", ["-qj", `dist/${name}.zip`, `dist/${name}/index.mjs`]);
  const size = statSync(`dist/${name}.zip`).size;
  if (size > VIEWER_LIMIT) throw new Error(`${name}.zip is ${size} bytes (> 1MB)`);
  console.log(`[${stage}] ${name}: dist/${name}.zip (${(size / 1024).toFixed(1)} KB)`);
}
