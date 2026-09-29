import { createAuthHandler, forwardClaims } from "../shared/auth";
import { config } from "../shared/config";
import { createVerifier } from "../shared/verifier";

export const handler = createAuthHandler(createVerifier(config.accept), {
  corsOrigins: config.corsOrigins,
  onAuthorized: forwardClaims(),
});
