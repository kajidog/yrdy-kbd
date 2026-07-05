import { Role as KVSRole, SignalingClient } from 'amazon-kinesis-video-streams-webrtc'
import { createBFFRequestSigner } from './bffRequestSigner'
import type { SessionConfig } from './types'

export type ViewerRuntime = {
  stop: () => void
}

type StartViewerOptions = {
  roomId: string
  passphrase: string
  clientId: string
  session: SessionConfig
  onRemoteStream: (stream: MediaStream) => void
  onStatus: (message: string) => void
}

type ViewerSignalingClient = SignalingClient & {
  on(event: 'open' | 'close', listener: () => void): ViewerSignalingClient
  on(event: 'error', listener: (error: Error) => void): ViewerSignalingClient
  on(
    event: 'sdpAnswer',
    listener: (answer: RTCSessionDescriptionInit, remoteClientId?: string) => void,
  ): ViewerSignalingClient
  on(
    event: 'iceCandidate',
    listener: (candidate: RTCIceCandidateInit, remoteClientId?: string) => void,
  ): ViewerSignalingClient
}

export async function startViewer(options: StartViewerOptions): Promise<ViewerRuntime> {
  const connection = new RTCPeerConnection({
    iceServers: options.session.iceServers,
  })

  const signalingClient = new SignalingClient({
    role: KVSRole.VIEWER,
    channelARN: options.session.channelArn,
    channelEndpoint: options.session.endpoints.wss,
    region: options.session.region,
    clientId: options.clientId,
    requestSigner: createBFFRequestSigner({
      roomId: options.roomId,
      passphrase: options.passphrase,
      role: 'VIEWER',
      clientId: options.clientId,
    }),
    enableEarlyIceCandidateBuffering: true,
  }) as ViewerSignalingClient

  connection.addTransceiver('video', { direction: 'recvonly' })

  connection.addEventListener('track', (event) => {
    const [stream] = event.streams
    if (stream) {
      options.onRemoteStream(stream)
    }
  })

  connection.addEventListener('icecandidate', ({ candidate }) => {
    if (candidate) {
      signalingClient.sendIceCandidate(candidate)
    }
  })

  connection.addEventListener('connectionstatechange', () => {
    options.onStatus(`WebRTC ${connection.connectionState}`)
  })

  signalingClient.on('open', async () => {
    options.onStatus('KVS signaling connected')
    const offer = await connection.createOffer()
    await connection.setLocalDescription(offer)
    if (connection.localDescription) {
      signalingClient.sendSdpOffer(connection.localDescription)
    }
  })

  signalingClient.on('close', () => {
    options.onStatus('KVS signaling closed')
  })

  signalingClient.on('error', (error: Error) => {
    options.onStatus(error.message)
  })

  signalingClient.on('sdpAnswer', async (answer: RTCSessionDescriptionInit) => {
    await connection.setRemoteDescription(answer)
    signalingClient.drainPendingIceCandidates()
  })

  signalingClient.on('iceCandidate', async (candidate: RTCIceCandidateInit) => {
    await connection.addIceCandidate(candidate)
  })

  signalingClient.open()

  return {
    stop() {
      signalingClient.close()
      connection.close()
    },
  }
}
