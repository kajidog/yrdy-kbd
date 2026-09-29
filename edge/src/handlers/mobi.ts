import { createAuthHandler, forwardSub } from "../shared/auth";
import { config } from "../shared/config";
import { createIdTokenVerifier } from "../shared/verifier";

export const handler = createAuthHandler(createIdTokenVerifier(), {
  corsOrigins: config.corsOrigins,
  onAuthorized: forwardSub(),
});
