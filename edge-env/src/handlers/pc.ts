import { createAuthHandler, forwardClaims } from "../shared/auth";
import { auth0, cognito, list } from "../shared/providers";
import { createVerifier } from "../shared/verifier";

// Cognito の ID トークンと、Auth0 のアクセストークンの両方を受け付ける例
export const handler = createAuthHandler(
  createVerifier([
    cognito({
      userPoolId: process.env.EDGE_COGNITO_USER_POOL_ID,
      clientId: process.env.EDGE_PC_COGNITO_CLIENT_ID,
      tokenUse: "id",
    }),
    auth0({
      domain: process.env.EDGE_AUTH0_DOMAIN,
      audience: process.env.EDGE_AUTH0_AUDIENCE, // Auth0 の API Identifier
    }),
  ]),
  {
    publicPaths: ["/healthz"],
    corsOrigins: list(process.env.EDGE_CORS_ORIGINS),
    onAuthorized: forwardClaims(),
  },
);
