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
  roomId: string
  role: Role
  region: string
  channelArn: string
  endpoints: EndpointSet
  iceServers: IceServerConfig[]
}

export type CreateRoomResponse = {
  roomId: string
  channelArn: string
  publishUrl: string
  watchUrl: string
}

export type SignalingURLResponse = {
  signedUrl: string
}
