import type { QueryParams, RequestSigner } from 'amazon-kinesis-video-streams-webrtc'
import { signSignalingURL } from './api'
import type { Role } from './types'

type BFFRequestSignerOptions = {
  liveId: string
  passphrase?: string
  role: Role
  clientId?: string
}

export function createBFFRequestSigner(options: BFFRequestSignerOptions): RequestSigner {
  return {
    async getSignedURL(endpoint: string, queryParams: QueryParams, _date?: Date) {
      const response = await signSignalingURL({
        liveId: options.liveId,
        passphrase: options.passphrase,
        role: options.role,
        clientId: options.clientId,
        endpoint,
        queryParams,
      })
      return response.signedUrl
    },
  }
}
