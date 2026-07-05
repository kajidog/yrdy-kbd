import { Role as KVSRole, SignalingClient } from 'amazon-kinesis-video-streams-webrtc'
import { createBFFRequestSigner } from './bffRequestSigner'
import type { SessionConfig } from './types'

export type PublisherRuntime = {
  stop: () => void
}

type StartPublisherOptions = {
  roomId: string
  passphrase: string
  session: SessionConfig
  stream: MediaStream
  onStatus: (message: string) => void
  onPeerCount: (count: number) => void
}

type PeerEntry = {
  connection: RTCPeerConnection
}

type PublisherSignalingClient = SignalingClient & {
  on(event: 'open' | 'close', listener: () => void): PublisherSignalingClient
  on(event: 'error', listener: (error: Error) => void): PublisherSignalingClient
  on(
    event: 'sdpOffer',
    listener: (offer: RTCSessionDescriptionInit, remoteClientId?: string) => void,
  ): PublisherSignalingClient
  on(
    event: 'iceCandidate',
    listener: (candidate: RTCIceCandidateInit, remoteClientId?: string) => void,
  ): PublisherSignalingClient
}

export async function startPublisher(options: StartPublisherOptions): Promise<PublisherRuntime> {
  const peers = new Map<string, PeerEntry>()
  const rtcConfig: RTCConfiguration = {
    iceServers: options.session.iceServers,
  }

  const signalingClient = new SignalingClient({
    role: KVSRole.MASTER,
    channelARN: options.session.channelArn,
    channelEndpoint: options.session.endpoints.wss,
    region: options.session.region,
    requestSigner: createBFFRequestSigner({
      roomId: options.roomId,
      passphrase: options.passphrase,
      role: 'MASTER',
    }),
    enableEarlyIceCandidateBuffering: true,
  }) as PublisherSignalingClient

  function closePeer(clientId: string) {
    const peer = peers.get(clientId)
    if (!peer) {
      return
    }
    peer.connection.close()
    peers.delete(clientId)
    options.onPeerCount(peers.size)
  }

  signalingClient.on('open', () => {
    options.onStatus('KVS signaling connected')
  })

  signalingClient.on('close', () => {
    options.onStatus('KVS signaling closed')
  })

  signalingClient.on('error', (error: Error) => {
    options.onStatus(error.message)
  })

  signalingClient.on(
    'sdpOffer',
    async (offer: RTCSessionDescriptionInit, remoteClientId?: string) => {
      if (!remoteClientId) {
        options.onStatus('Received SDP offer without viewer client id')
        return
      }

      closePeer(remoteClientId)
      const connection = new RTCPeerConnection(rtcConfig)
      peers.set(remoteClientId, { connection })
      options.onPeerCount(peers.size)

      for (const track of options.stream.getTracks()) {
        connection.addTrack(track, options.stream)
      }

      connection.addEventListener('icecandidate', ({ candidate }) => {
        if (candidate) {
          signalingClient.sendIceCandidate(candidate, remoteClientId)
        }
      })

      connection.addEventListener('connectionstatechange', () => {
        const state = connection.connectionState
        options.onStatus(`Viewer ${remoteClientId}: ${state}`)
        if (state === 'failed' || state === 'disconnected' || state === 'closed') {
          closePeer(remoteClientId)
        }
      })

      await connection.setRemoteDescription(offer)
      signalingClient.drainPendingIceCandidates(remoteClientId)

      const answer = await connection.createAnswer()
      await connection.setLocalDescription(answer)
      if (connection.localDescription) {
        signalingClient.sendSdpAnswer(connection.localDescription, remoteClientId)
      }
    },
  )

  signalingClient.on(
    'iceCandidate',
    async (candidate: RTCIceCandidateInit, remoteClientId?: string) => {
      if (!remoteClientId) {
        return
      }
      const peer = peers.get(remoteClientId)
      if (!peer) {
        return
      }
      await peer.connection.addIceCandidate(candidate)
    },
  )

  signalingClient.open()

  return {
    stop() {
      signalingClient.close()
      for (const peer of peers.values()) {
        peer.connection.close()
      }
      peers.clear()
      options.onPeerCount(0)
    },
  }
}
