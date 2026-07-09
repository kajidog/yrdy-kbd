import type { QueryParams, RequestSigner } from 'amazon-kinesis-video-streams-webrtc'

// SignSignalingURL asks the BFF to sign a KVS signaling WSS URL. Each app
// implements it with its generated signSignalingUrl mutation.
export type SignSignalingURL = (
  endpoint: string,
  queryParams: Record<string, string>,
) => Promise<string>

// createBFFRequestSigner adapts a SignSignalingURL into the RequestSigner
// interface the KVS WebRTC SDK expects, so the AWS credentials never leave
// the BFF.
export function createBFFRequestSigner(sign: SignSignalingURL): RequestSigner {
  return {
    async getSignedURL(endpoint: string, queryParams: QueryParams, _date?: Date) {
      return sign(endpoint, queryParams as Record<string, string>)
    },
  }
}
