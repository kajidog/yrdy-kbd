// Structural session types used by the KVS WebRTC helpers. The apps' codegen
// SessionConfig results are assignable to these, so the helpers stay
// independent of the generated GraphQL types.

export type KVSIceServer = {
  urls: string[]
  username?: string | null
  credential?: string | null
  ttl?: number | null
}

export type KVSSession = {
  region: string
  channelArn: string
  endpoints: { wss: string; https: string }
  iceServers: KVSIceServer[]
}

export function toRTCIceServers(servers: KVSIceServer[]): RTCIceServer[] {
  return servers.map((server) => ({
    urls: server.urls,
    username: server.username ?? undefined,
    credential: server.credential ?? undefined,
  }))
}
