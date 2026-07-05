import { getIdToken } from './auth'
import type { LiveSummary, Role, SessionConfig, SignalingURLResponse } from './types'

const bffBaseURL = import.meta.env.VITE_BFF_BASE_URL ?? 'http://localhost:8080'

export type CreateLiveInput = {
  title: string
  passphrase?: string
  public: boolean
  record: boolean
}

export async function createLive(input: CreateLiveInput): Promise<LiveSummary> {
  return requestJSON<LiveSummary>('/api/lives', {
    method: 'POST',
    body: JSON.stringify({
      title: input.title,
      passphrase: input.passphrase || undefined,
      public: input.public,
      record: input.record,
    }),
  })
}

export async function listMyLives(): Promise<LiveSummary[]> {
  const response = await requestJSON<{ lives: LiveSummary[] }>('/api/me/lives', { method: 'GET' })
  return response.lives
}

export async function createPublisherSession(liveId: string): Promise<SessionConfig> {
  return requestJSON<SessionConfig>(`/api/lives/${liveId}/publisher-session`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export async function joinStorageSession(liveId: string): Promise<void> {
  await requestJSON<{ status: string }>(`/api/lives/${liveId}/storage-session`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export async function stopLive(liveId: string): Promise<LiveSummary> {
  return requestJSON<LiveSummary>(`/api/lives/${liveId}/stop`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export async function signSignalingURL(input: {
  liveId: string
  role: Role
  clientId?: string
  endpoint: string
  queryParams: Record<string, string>
}): Promise<SignalingURLResponse> {
  return requestJSON<SignalingURLResponse>(`/api/lives/${input.liveId}/signaling-url`, {
    method: 'POST',
    body: JSON.stringify({
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
