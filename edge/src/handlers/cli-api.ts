import { createAuthHandler } from "../shared/auth";
import { createIdTokenVerifier } from "../shared/verifier";

export const handler = createAuthHandler(createIdTokenVerifier(), {
  allowPreflight: false,
});
