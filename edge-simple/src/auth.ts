import type { CloudFrontRequestHandler } from "aws-lambda";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { USER_POOL_ID } from "./config";

const unauthorized = {
  status: "401",
  statusDescription: "Unauthorized",
  body: "Unauthorized",
};

// 指定したクライアント ID の Cognito ID トークンを検証するハンドラーを作る
export const createAuthHandler = (clientId: string): CloudFrontRequestHandler => {
  const verifier = CognitoJwtVerifier.create({
    userPoolId: USER_POOL_ID,
    clientId,
    tokenUse: "id",
  });

  return async (event) => {
    const request = event.Records[0].cf.request;
    const token = request.headers.authorization?.[0]?.value.replace(/^Bearer /i, "");
    if (!token) return unauthorized;

    try {
      await verifier.verify(token);
      return request;
    } catch {
      return unauthorized;
    }
  };
};
