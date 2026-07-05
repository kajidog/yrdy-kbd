// Cognito auth over plain fetch (USER_PASSWORD_AUTH). The BFF never verifies
// token signatures itself: that happens at CloudFront via Lambda@Edge. When the
// Cognito env vars are missing, a locally minted unsigned JWT is used instead
// so the whole stack can run without a user pool ("dev mode").

const region = import.meta.env.VITE_COGNITO_REGION ?? import.meta.env.VITE_AWS_REGION ?? 'ap-northeast-1'
const userPoolId = import.meta.env.VITE_COGNITO_USER_POOL_ID ?? ''
const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID ?? ''

export const cognitoEnabled = Boolean(userPoolId && clientId)

const storageKey = 'yrdy-kbd-session'

export type AuthSession = {
  username: string
  userId: string
  idToken: string
  refreshToken?: string
  expiresAt: number
  dev: boolean
}

type CognitoAuthResult = {
  AuthenticationResult?: {
    IdToken?: string
    RefreshToken?: string
    ExpiresIn?: number
  }
  ChallengeName?: string
}

async function cognitoRequest<T>(target: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(body),
  })
  const data = (await response.json().catch(() => ({}))) as { message?: string; __type?: string }
  if (!response.ok) {
    throw new Error(data.message ?? data.__type ?? `${target} failed with ${response.status}`)
  }
  return data as T
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const segment = token.split('.')[1] ?? ''
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/')
  try {
    return JSON.parse(atob(normalized)) as Record<string, unknown>
  } catch {
    return {}
  }
}

function sessionFromIdToken(idToken: string, refreshToken: string | undefined, dev: boolean): AuthSession {
  const claims = decodeJwtPayload(idToken)
  const username =
    (claims['cognito:username'] as string) ||
    (claims.preferred_username as string) ||
    (claims.email as string) ||
    (claims.sub as string) ||
    'unknown'
  return {
    username,
    userId: (claims.sub as string) ?? 'unknown',
    idToken,
    refreshToken,
    expiresAt: typeof claims.exp === 'number' ? claims.exp * 1000 : Date.now() + 3600_000,
    dev,
  }
}

function base64Url(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function mintDevToken(username: string): string {
  const now = Math.floor(Date.now() / 1000)
  const header = base64Url(JSON.stringify({ alg: 'none', typ: 'JWT' }))
  const payload = base64Url(
    JSON.stringify({
      sub: `dev-${username}`,
      'cognito:username': username,
      exp: now + 12 * 3600,
      iat: now,
    }),
  )
  return `${header}.${payload}.${base64Url('dev')}`
}

export function loadSession(): AuthSession | null {
  const raw = localStorage.getItem(storageKey)
  if (!raw) {
    return null
  }
  try {
    return JSON.parse(raw) as AuthSession
  } catch {
    localStorage.removeItem(storageKey)
    return null
  }
}

function storeSession(session: AuthSession): AuthSession {
  localStorage.setItem(storageKey, JSON.stringify(session))
  return session
}

export function signOut() {
  localStorage.removeItem(storageKey)
}

export async function signIn(username: string, password: string): Promise<AuthSession> {
  if (!cognitoEnabled) {
    const trimmed = username.trim()
    if (!trimmed) {
      throw new Error('Username is required')
    }
    return storeSession(sessionFromIdToken(mintDevToken(trimmed), undefined, true))
  }

  const result = await cognitoRequest<CognitoAuthResult>('InitiateAuth', {
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: clientId,
    AuthParameters: { USERNAME: username, PASSWORD: password },
  })
  const idToken = result.AuthenticationResult?.IdToken
  if (!idToken) {
    throw new Error(result.ChallengeName ? `Unsupported challenge: ${result.ChallengeName}` : 'Sign-in returned no token')
  }
  return storeSession(sessionFromIdToken(idToken, result.AuthenticationResult?.RefreshToken, false))
}

export async function signUp(username: string, password: string, email: string): Promise<void> {
  await cognitoRequest('SignUp', {
    ClientId: clientId,
    Username: username,
    Password: password,
    UserAttributes: [{ Name: 'email', Value: email }],
  })
}

export async function confirmSignUp(username: string, code: string): Promise<void> {
  await cognitoRequest('ConfirmSignUp', {
    ClientId: clientId,
    Username: username,
    ConfirmationCode: code,
  })
}

async function refreshSession(session: AuthSession): Promise<AuthSession> {
  if (session.dev) {
    return storeSession(sessionFromIdToken(mintDevToken(session.username), undefined, true))
  }
  if (!session.refreshToken) {
    throw new Error('Session expired')
  }
  const result = await cognitoRequest<CognitoAuthResult>('InitiateAuth', {
    AuthFlow: 'REFRESH_TOKEN_AUTH',
    ClientId: clientId,
    AuthParameters: { REFRESH_TOKEN: session.refreshToken },
  })
  const idToken = result.AuthenticationResult?.IdToken
  if (!idToken) {
    throw new Error('Session expired')
  }
  return storeSession(sessionFromIdToken(idToken, session.refreshToken, false))
}

// getIdToken returns a token that is valid for at least another minute,
// refreshing (or re-minting in dev mode) when needed.
export async function getIdToken(): Promise<string> {
  let session = loadSession()
  if (!session) {
    throw new Error('Not signed in')
  }
  if (session.expiresAt - Date.now() < 60_000) {
    try {
      session = await refreshSession(session)
    } catch (error) {
      signOut()
      throw error
    }
  }
  return session.idToken
}
