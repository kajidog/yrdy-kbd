import { createAuthHandler, forwardSub } from "../shared/auth";
import { config } from "../shared/config";
import { createIdTokenVerifier } from "../shared/verifier";

export const handler = createAuthHandler(createIdTokenVerifier(), {
  publicPaths: ["/healthz"],
  corsOrigins: config.corsOrigins,
  onAuthorized: forwardSub(),
});
