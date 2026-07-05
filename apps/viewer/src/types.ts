export type Role = 'MASTER' | 'VIEWER'

export type EndpointSet = {
  wss: string
  https: string
}

export type IceServerConfig = {
  urls: string[]
  username?: string
  credential?: string
  ttl?: number
}

export type SessionConfig = {
  liveId: string
  role: Role
  region: string
  channelArn: string
  endpoints: EndpointSet
  iceServers: IceServerConfig[]
}

export type LiveStatus = 'created' | 'live' | 'ended'

export type LiveSummary = {
  id: string
  title: string
  ownerName: string
  public: boolean
  record: boolean
  status: LiveStatus
  hasPassphrase: boolean
  hasRecording: boolean
  owned: boolean
  createdAt: string
  startedAt?: string
  endedAt?: string
  durationSeconds?: number
  watchUrl: string
}

export type PlaybackInfo = {
  liveId: string
  hlsUrl: string
  playbackMode: 'LIVE' | 'ON_DEMAND'
  startedAt?: string
  endedAt?: string
  durationSeconds?: number
}

export type SignalingURLResponse = {
  signedUrl: string
}
