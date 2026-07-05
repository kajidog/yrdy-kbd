import { getIdToken } from './auth'
import type { LiveSummary, PlaybackInfo, Role, SessionConfig, SignalingURLResponse } from './types'

const bffBaseURL = import.meta.env.VITE_BFF_BASE_URL ?? 'http://localhost:8080'

export async function searchLives(query: string): Promise<LiveSummary[]> {
  const params = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : ''
  const response = await requestJSON<{ lives: LiveSummary[] }>(`/api/lives${params}`, {
    method: 'GET',
  })
  return response.lives
}

export async function getLive(liveId: string): Promise<LiveSummary> {
  return requestJSON<LiveSummary>(`/api/lives/${liveId}`, { method: 'GET' })
}

export async function createViewerSession(input: {
  liveId: string
  passphrase?: string
  clientId: string
}): Promise<SessionConfig> {
  return requestJSON<SessionConfig>(`/api/lives/${input.liveId}/viewer-session`, {
    method: 'POST',
    body: JSON.stringify({
      passphrase: input.passphrase || undefined,
      clientId: input.clientId,
    }),
  })
}

export async function getPlayback(input: {
  liveId: string
  passphrase?: string
}): Promise<PlaybackInfo> {
  return requestJSON<PlaybackInfo>(`/api/lives/${input.liveId}/playback`, {
    method: 'POST',
    body: JSON.stringify({ passphrase: input.passphrase || undefined }),
  })
}

export async function signSignalingURL(input: {
  liveId: string
  passphrase?: string
  role: Role
  clientId?: string
  endpoint: string
  queryParams: Record<string, string>
}): Promise<SignalingURLResponse> {
  return requestJSON<SignalingURLResponse>(`/api/lives/${input.liveId}/signaling-url`, {
    method: 'POST',
    body: JSON.stringify({
      passphrase: input.passphrase || undefined,
      role: input.role,
      clientId: input.clientId,
      endpoint: input.endpoint,
      queryParams: input.queryParams,
    }),
  })
}

async function requestJSON<T>(path: string, init: RequestInit): Promise<T> {
  const token = await getIdToken()
  const response = await fetch(`${bffBaseURL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
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
