import {
  browserLogger,
  createBFFRequestSigner,
  toRTCIceServers,
  type KVSSession,
  type SignSignalingURL,
} from '@yrdy-kbd/web-shared'
import { Role as KVSRole, SignalingClient } from 'amazon-kinesis-video-streams-webrtc'

export type ViewerRuntime = {
  stop: () => void
}

type StartViewerOptions = {
  clientId: string
  session: KVSSession
  signUrl: SignSignalingURL
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
    iceServers: toRTCIceServers(options.session.iceServers),
  })

  const signalingClient = new SignalingClient({
    role: KVSRole.VIEWER,
    channelARN: options.session.channelArn,
    channelEndpoint: options.session.endpoints.wss,
    region: options.session.region,
    clientId: options.clientId,
    requestSigner: createBFFRequestSigner(options.signUrl),
    enableEarlyIceCandidateBuffering: true,
  }) as ViewerSignalingClient

  browserLogger.info('Viewer WebRTC starting', {
    event_name: 'viewer_webrtc_starting',
    channel_arn: options.session.channelArn,
    client_id: options.clientId,
  })

  connection.addTransceiver('video', { direction: 'recvonly' })

  connection.addEventListener('track', (event) => {
    browserLogger.info('Viewer received remote track', {
      event_name: 'viewer_remote_track_received',
      client_id: options.clientId,
      track_kind: event.track.kind,
      track_state: event.track.readyState,
      stream_count: event.streams.length,
    })
    const [stream] = event.streams
    if (stream) {
      options.onRemoteStream(stream)
    }
  })

  connection.addEventListener('icecandidate', ({ candidate }) => {
    if (candidate) {
      signalingClient.sendIceCandidate(candidate)
    } else {
      browserLogger.debug('Viewer ICE gathering completed', {
        event_name: 'viewer_ice_gathering_completed',
        client_id: options.clientId,
      })
    }
  })

  connection.addEventListener('iceconnectionstatechange', () => {
    browserLogger.info('Viewer ICE connection state changed', {
      event_name: 'viewer_ice_state_changed',
      client_id: options.clientId,
      ice_connection_state: connection.iceConnectionState,
    })
  })

  connection.addEventListener('connectionstatechange', () => {
    browserLogger.info('Viewer peer connection state changed', {
      event_name: 'viewer_peer_state_changed',
      client_id: options.clientId,
      connection_state: connection.connectionState,
    })
    options.onStatus(`WebRTC ${connection.connectionState}`)
  })

  signalingClient.on('open', async () => {
    browserLogger.info('Viewer KVS signaling connected', {
      event_name: 'viewer_signaling_connected',
      channel_arn: options.session.channelArn,
      client_id: options.clientId,
    })
    options.onStatus('KVS signaling connected')
    try {
      const offer = await connection.createOffer()
      await connection.setLocalDescription(offer)
      if (connection.localDescription) {
        signalingClient.sendSdpOffer(connection.localDescription)
        browserLogger.info('Viewer sent SDP offer', {
          event_name: 'viewer_sdp_offer_sent',
          client_id: options.clientId,
        })
      }
    } catch (caught) {
      const error = caught instanceof Error ? caught : new Error(String(caught))
      browserLogger.error(
        'Viewer failed to create SDP offer',
        {
          event_name: 'viewer_sdp_offer_failed',
          client_id: options.clientId,
        },
        error,
      )
      options.onStatus(error.message)
    }
  })

  signalingClient.on('close', () => {
    browserLogger.warn('Viewer KVS signaling closed', {
      event_name: 'viewer_signaling_closed',
      client_id: options.clientId,
    })
    options.onStatus('KVS signaling closed')
  })

  signalingClient.on('error', (error: Error) => {
    browserLogger.error(
      'Viewer KVS signaling failed',
      {
        event_name: 'viewer_signaling_failed',
        client_id: options.clientId,
      },
      error,
    )
    options.onStatus(error.message)
  })

  signalingClient.on('sdpAnswer', async (answer: RTCSessionDescriptionInit) => {
    browserLogger.info('Viewer received SDP answer', {
      event_name: 'viewer_sdp_answer_received',
      client_id: options.clientId,
    })
    try {
      await connection.setRemoteDescription(answer)
      signalingClient.drainPendingIceCandidates()
    } catch (caught) {
      const error = caught instanceof Error ? caught : new Error(String(caught))
      browserLogger.error(
        'Viewer failed to apply SDP answer',
        {
          event_name: 'viewer_sdp_answer_failed',
          client_id: options.clientId,
        },
        error,
      )
      options.onStatus(error.message)
    }
  })

  signalingClient.on('iceCandidate', async (candidate: RTCIceCandidateInit) => {
    try {
      await connection.addIceCandidate(candidate)
    } catch (caught) {
      const error = caught instanceof Error ? caught : new Error(String(caught))
      browserLogger.error(
        'Viewer failed to add ICE candidate',
        {
          event_name: 'viewer_ice_candidate_failed',
          client_id: options.clientId,
        },
        error,
      )
    }
  })

  signalingClient.open()

  return {
    stop() {
      browserLogger.info('Viewer WebRTC stopping', {
        event_name: 'viewer_webrtc_stopping',
        client_id: options.clientId,
        connection_state: connection.connectionState,
      })
      signalingClient.close()
      connection.close()
    },
  }
}
