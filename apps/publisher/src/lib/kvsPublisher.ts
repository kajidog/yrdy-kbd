import {
  createBFFRequestSigner,
  toRTCIceServers,
  type KVSSession,
  type SignSignalingURL,
} from '@yrdy-kbd/web-shared'
import { Role as KVSRole, SignalingClient } from 'amazon-kinesis-video-streams-webrtc'

export type PublisherRuntime = {
  stop: () => void
}

type StartPublisherOptions = {
  session: KVSSession
  signUrl: SignSignalingURL
  stream: MediaStream
  onStatus: (message: string) => void
  onPeerCount: (count: number) => void
  // Fired once the signaling socket is open. Used to ask the BFF to join the
  // storage session when recording: KVS then sends this master an SDP offer
  // like any other viewer and archives the answered media.
  onSignalingOpen?: () => void
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
    iceServers: toRTCIceServers(options.session.iceServers),
  }

  const signalingClient = new SignalingClient({
    role: KVSRole.MASTER,
    channelARN: options.session.channelArn,
    channelEndpoint: options.session.endpoints.wss,
    region: options.session.region,
    requestSigner: createBFFRequestSigner(options.signUrl),
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
    options.onSignalingOpen?.()
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

// KVS WebRTC media ingestion requires both a video and an audio track. Screen
// captures often have no audio, so recording-enabled lives get a silent Opus
// track appended.
export function createSilentAudioTrack(): { track: MediaStreamTrack; stop: () => void } {
  const audioContext = new AudioContext()
  const destination = audioContext.createMediaStreamDestination()
  const oscillator = audioContext.createOscillator()
  const gain = audioContext.createGain()
  gain.gain.value = 0
  oscillator.connect(gain)
  gain.connect(destination)
  oscillator.start()

  const track = destination.stream.getAudioTracks()[0]
  return {
    track,
    stop() {
      oscillator.stop()
      track.stop()
      void audioContext.close()
    },
  }
}
