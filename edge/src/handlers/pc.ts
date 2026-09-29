import { createAuthHandler, forwardSub } from "../shared/auth";
import { createIdTokenVerifier } from "../shared/verifier";

export const handler = createAuthHandler(createIdTokenVerifier(), {
  publicPaths: ["/health"],
  onAuthorized: forwardSub(),
});
