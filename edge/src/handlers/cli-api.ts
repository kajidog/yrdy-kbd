import { createAuthHandler } from "../shared/auth";
import { config } from "../shared/config";
import { createVerifier } from "../shared/verifier";

export const handler = createAuthHandler(createVerifier(config.accept), {
  allowPreflight: false,
});
