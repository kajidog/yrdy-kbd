import type {
  CloudFrontHeaders,
  CloudFrontRequest,
  CloudFrontRequestEvent,
  CloudFrontRequestResult,
} from "aws-lambda";
import { unauthorized } from "./response";

export type Claims = Record<string, unknown> & { sub: string };

/** aws-jwt-verify の verifier と互換。テストで差し替えられるように最小限の型にしている */
export type TokenVerifier = {
  verify(token: string): Promise<Claims>;
};

export type AuthHandlerOptions = {
  /** トークンを読むヘッダー名（小文字）。既定: authorization */
  header?: string;
  /** 認証をスキップするパス（ヘルスチェック等） */
  publicPaths?: (string | RegExp)[];
  /** CORS プリフライト (OPTIONS) を素通しするか。既定: true */
  allowPreflight?: boolean;
  /**
   * ブラウザから呼ばれる場合に、Edge が返す 401 にも CORS ヘッダーを付ける許可オリジン。
   * 付けないとブラウザが CORS エラー扱いにし、クライアントが 401 を判別できない。
   */
  corsOrigins?: string[];
  /** 検証成功後にリクエストを加工する（オリジンにユーザー情報を渡す等） */
  onAuthorized?: (request: CloudFrontRequest, claims: Claims) => void;
};

const getHeader = (headers: CloudFrontHeaders, name: string) =>
  headers[name]?.[0]?.value;

const extractBearer = (value: string | undefined) => {
  const m = value?.match(/^Bearer\s+(.+)$/i);
  return m?.[1];
};

const isPublic = (uri: string, paths: (string | RegExp)[]) =>
  paths.some((p) => {
    if (typeof p === "string") return uri === p;
    // g / y フラグ付きの正規表現は lastIndex を保持するため、
    // ウォームコンテナで結果が交互に変わらないよう毎回リセットする
    p.lastIndex = 0;
    return p.test(uri);
  });

const corsHeaders = (headers: CloudFrontHeaders, allowed: string[]): CloudFrontHeaders => {
  const origin = getHeader(headers, "origin");
  if (!origin || !allowed.includes(origin)) return {};
  return {
    "access-control-allow-origin": [{ key: "Access-Control-Allow-Origin", value: origin }],
    vary: [{ key: "Vary", value: "Origin" }],
  };
};

export const createAuthHandler = (
  verifier: TokenVerifier,
  options: AuthHandlerOptions = {},
) => {
  const {
    header = "authorization",
    publicPaths = [],
    allowPreflight = true,
    corsOrigins = [],
    onAuthorized,
  } = options;

  return async (event: CloudFrontRequestEvent): Promise<CloudFrontRequestResult> => {
    const request = event.Records[0].cf.request;

    if (allowPreflight && request.method === "OPTIONS") return request;
    if (isPublic(request.uri, publicPaths)) return request;

    const deny = () => unauthorized(corsHeaders(request.headers, corsOrigins));

    const token = extractBearer(getHeader(request.headers, header));
    if (!token) return deny();

    let claims: Claims;
    try {
      claims = await verifier.verify(token);
    } catch (e) {
      console.warn("token verification failed", (e as Error).message);
      return deny();
    }

    // スキームの大文字小文字を問わず受け付けるので、オリジンには正規形で渡す
    // （オリジン側が "Bearer " を大文字小文字区別で解析しても通るように）
    const key = request.headers[header]?.[0]?.key ?? header;
    request.headers[header] = [{ key, value: `Bearer ${token}` }];

    onAuthorized?.(request, claims);
    return request;
  };
};

/** よく使う onAuthorized: sub をオリジン向けヘッダーに載せる */
export const forwardSub = (name = "x-user-sub") => forwardClaims({ sub: name });

/**
 * クレームをオリジン向けヘッダーに載せる。複数の IdP を受け付ける場合、sub は IdP 間で
 * 一意とは限らないので iss も渡し、オリジン側は (iss, sub) の組でユーザーを識別する。
 * クライアントが同名ヘッダーを送ってきても、ここで必ず上書き（クレームがなければ削除）する。
 */
export const forwardClaims =
  (mapping: Record<string, string> = { sub: "x-user-sub", iss: "x-user-iss" }) =>
  (request: CloudFrontRequest, claims: Claims) => {
    for (const [claim, name] of Object.entries(mapping)) {
      const value = claims[claim];
      if (typeof value === "string") request.headers[name] = [{ key: name, value }];
      else delete request.headers[name];
    }
  };
