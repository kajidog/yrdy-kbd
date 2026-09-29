// 使い方: STAGE=dev node build.mjs
// 出力: dist/<name>/index.mjs と dist/<name>.zip（Lambda@Edge にそのままデプロイできる形）
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, statSync } from "node:fs";

const stage = process.env.STAGE ?? "dev";
const stageConfig = JSON.parse(readFileSync(`config/${stage}.json`, "utf8"));

const handlers = ["mobi", "pc", "cli-api"];
const VIEWER_LIMIT = 1024 * 1024; // viewer-request トリガーの zip 上限 1MB

rmSync("dist", { recursive: true, force: true });

for (const name of handlers) {
  const clientId = stageConfig.clientIds[name];
  if (!clientId) throw new Error(`clientIds.${name} is missing in config/${stage}.json`);

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
      __EDGE_CONFIG__: JSON.stringify({ userPoolId: stageConfig.userPoolId, clientId }),
    },
    logLevel: "warning",
  });

  execFileSync("zip", ["-qj", `dist/${name}.zip`, `dist/${name}/index.mjs`]);
  const size = statSync(`dist/${name}.zip`).size;
  if (size > VIEWER_LIMIT) throw new Error(`${name}.zip is ${size} bytes (> 1MB)`);
  console.log(`[${stage}] ${name}: dist/${name}.zip (${(size / 1024).toFixed(1)} KB)`);
}
