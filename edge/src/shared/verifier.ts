import { CognitoJwtVerifier } from "aws-jwt-verify";
import { config } from "./config";

// ハンドラーのモジュールスコープで1回だけ生成する。
// JWKS はインスタンス内にキャッシュされ、コンテナ再利用時は再取得されない。
export const createIdTokenVerifier = () =>
  CognitoJwtVerifier.create({
    userPoolId: config.userPoolId,
    clientId: config.clientId,
    tokenUse: "id",
  });
