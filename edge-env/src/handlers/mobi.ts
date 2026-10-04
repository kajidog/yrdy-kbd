import { createAuthHandler, forwardClaims } from "../shared/auth";
import { cognito, list } from "../shared/providers";
import { createVerifier } from "../shared/verifier";

// process.env.EDGE_* はビルド時に値へ置き換わる（build.mjs）。実行時に環境変数は読まない
export const handler = createAuthHandler(
  createVerifier([
    cognito({
      userPoolId: process.env.EDGE_COGNITO_USER_POOL_ID,
      clientId: process.env.EDGE_MOBI_COGNITO_CLIENT_ID,
      tokenUse: "id",
    }),
  ]),
  {
    corsOrigins: list(process.env.EDGE_CORS_ORIGINS),
    onAuthorized: forwardClaims(),
  },
);
