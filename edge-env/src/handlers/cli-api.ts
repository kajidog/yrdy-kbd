import { createAuthHandler } from "../shared/auth";
import { keycloak } from "../shared/providers";
import { createVerifier } from "../shared/verifier";

// Keycloak のアクセストークンを受け付ける例。
// aud は既定で "account" になりがちなので aud は見ず、発行先クライアント（azp）で絞る
export const handler = createAuthHandler(
  createVerifier([
    keycloak({
      issuer: process.env.EDGE_KEYCLOAK_ISSUER,
      audience: null,
      claims: { azp: process.env.EDGE_CLI_API_KEYCLOAK_CLIENT_ID ?? "" },
    }),
  ]),
  { allowPreflight: false },
);
