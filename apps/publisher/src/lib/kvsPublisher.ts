import {
  browserLogger,
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

  browserLogger.info('Publisher WebRTC starting', {
    event_name: 'publisher_webrtc_starting',
    channel_arn: options.session.channelArn,
    local_track_kinds: options.stream.getTracks().map((track) => track.kind),
  })

  function closePeer(clientId: string) {
    const peer = peers.get(clientId)
    if (!peer) {
      return
    }
    peer.connection.close()
    peers.delete(clientId)
    options.onPeerCount(peers.size)
    browserLogger.info('Publisher peer closed', {
      event_name: 'publisher_peer_closed',
      client_id: clientId,
      peer_count: peers.size,
    })
  }

  signalingClient.on('open', () => {
    browserLogger.info('Publisher KVS signaling connected', {
      event_name: 'publisher_signaling_connected',
      channel_arn: options.session.channelArn,
    })
    options.onStatus('KVS signaling connected')
    options.onSignalingOpen?.()
  })

  signalingClient.on('close', () => {
    browserLogger.warn('Publisher KVS signaling closed', {
      event_name: 'publisher_signaling_closed',
      channel_arn: options.session.channelArn,
    })
    options.onStatus('KVS signaling closed')
  })

  signalingClient.on('error', (error: Error) => {
    browserLogger.error(
      'Publisher KVS signaling failed',
      {
        event_name: 'publisher_signaling_failed',
        channel_arn: options.session.channelArn,
      },
      error,
    )
    options.onStatus(error.message)
  })

  signalingClient.on(
    'sdpOffer',
    async (offer: RTCSessionDescriptionInit, remoteClientId?: string) => {
      if (!remoteClientId) {
        browserLogger.warn('Publisher received SDP offer without client id', {
          event_name: 'publisher_sdp_offer_missing_client_id',
        })
        options.onStatus('Received SDP offer without viewer client id')
        return
      }

      browserLogger.info('Publisher received SDP offer', {
        event_name: 'publisher_sdp_offer_received',
        client_id: remoteClientId,
      })
      try {
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
          } else {
            browserLogger.debug('Publisher ICE gathering completed', {
              event_name: 'publisher_ice_gathering_completed',
              client_id: remoteClientId,
            })
          }
        })

        connection.addEventListener('iceconnectionstatechange', () => {
          browserLogger.info('Publisher ICE connection state changed', {
            event_name: 'publisher_ice_state_changed',
            client_id: remoteClientId,
            ice_connection_state: connection.iceConnectionState,
          })
        })

        connection.addEventListener('connectionstatechange', () => {
          const state = connection.connectionState
          browserLogger.info('Publisher peer connection state changed', {
            event_name: 'publisher_peer_state_changed',
            client_id: remoteClientId,
            connection_state: state,
          })
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
          browserLogger.info('Publisher sent SDP answer', {
            event_name: 'publisher_sdp_answer_sent',
            client_id: remoteClientId,
          })
        }
      } catch (caught) {
        const error = caught instanceof Error ? caught : new Error(String(caught))
        browserLogger.error(
          'Publisher failed to handle SDP offer',
          {
            event_name: 'publisher_sdp_offer_failed',
            client_id: remoteClientId,
          },
          error,
        )
        options.onStatus(`Viewer ${remoteClientId}: ${error.message}`)
        closePeer(remoteClientId)
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
        browserLogger.warn('Publisher received ICE candidate for unknown peer', {
          event_name: 'publisher_ice_candidate_unknown_peer',
          client_id: remoteClientId,
        })
        return
      }
      try {
        await peer.connection.addIceCandidate(candidate)
      } catch (caught) {
        const error = caught instanceof Error ? caught : new Error(String(caught))
        browserLogger.error(
          'Publisher failed to add ICE candidate',
          {
            event_name: 'publisher_ice_candidate_failed',
            client_id: remoteClientId,
          },
          error,
        )
      }
    },
  )

  signalingClient.open()

  return {
    stop() {
      browserLogger.info('Publisher WebRTC stopping', {
        event_name: 'publisher_webrtc_stopping',
        channel_arn: options.session.channelArn,
        peer_count: peers.size,
      })
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
