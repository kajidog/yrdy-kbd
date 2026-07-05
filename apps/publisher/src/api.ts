import type {
  CreateRoomResponse,
  Role,
  SessionConfig,
  SignalingURLResponse,
} from './types'

const bffBaseURL = import.meta.env.VITE_BFF_BASE_URL ?? 'http://localhost:8080'

export async function createRoom(passphrase: string): Promise<CreateRoomResponse> {
  return requestJSON<CreateRoomResponse>('/api/rooms', {
    method: 'POST',
    body: JSON.stringify({ passphrase }),
  })
}

export async function createPublisherSession(
  roomId: string,
  passphrase: string,
): Promise<SessionConfig> {
  return requestJSON<SessionConfig>(`/api/rooms/${roomId}/publisher-session`, {
    method: 'POST',
    body: JSON.stringify({ passphrase }),
  })
}

export async function signSignalingURL(input: {
  roomId: string
  passphrase: string
  role: Role
  clientId?: string
  endpoint: string
  queryParams: Record<string, string>
}): Promise<SignalingURLResponse> {
  return requestJSON<SignalingURLResponse>(`/api/rooms/${input.roomId}/signaling-url`, {
    method: 'POST',
    body: JSON.stringify({
      passphrase: input.passphrase,
      role: input.role,
      clientId: input.clientId,
      endpoint: input.endpoint,
      queryParams: input.queryParams,
    }),
  })
}

async function requestJSON<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${bffBaseURL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })

  if (!response.ok) {
    const error = await parseError(response)
    throw new Error(error)
  }

  return response.json() as Promise<T>
}

async function parseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string }
    return body.error ?? `Request failed with ${response.status}`
  } catch {
    return `Request failed with ${response.status}`
  }
}
