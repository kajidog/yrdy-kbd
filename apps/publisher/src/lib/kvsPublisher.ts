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
  // and archives the answered media. Unlike P2P viewers, that offer carries
  // no senderClientId, and replies to it must omit the recipient client id.
  onSignalingOpen?: () => void
  // Fired when the storage session peer connection is torn down while the
  // broadcast is still running, so the caller can rejoin the storage session.
  onStoragePeerClosed?: () => void
}

// Peer-map key for the storage session, whose signaling messages have no
// client id. Must never collide with a real viewer client id.
const STORAGE_PEER_ID = '__storage_session__'

type PeerEntry = {
  connection: RTCPeerConnection
}

// Emitted by KVS signaling when a message carrying a correlationId is
// rejected (or acknowledged); the storage session uses this to report why an
// SDP answer was not accepted.
type SignalingStatusResponse = {
  correlationId?: string
  errorType?: string
  statusCode?: string
  description?: string
  success?: boolean
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
  on(
    event: 'statusResponse',
    listener: (status: SignalingStatusResponse) => void,
  ): PublisherSignalingClient
}

let correlationCounter = 0

function nextCorrelationId(): string {
  correlationCounter += 1
  return `${Date.now()}-${correlationCounter}`
}

// Logs what the browser is sending to the storage session and — via RTCP
// receiver reports — what the storage session actually received, to tell
// encoder stalls, path packet loss, and KVS-side rejection apart.
async function logStorageStats(connection: RTCPeerConnection, atSeconds: number) {
  try {
    const stats = await connection.getStats()
    const byId = new Map<string, Record<string, unknown>>()
    stats.forEach((report) => {
      byId.set(report.id, report as Record<string, unknown>)
    })
    const outbound: Record<string, unknown>[] = []
    const remoteInbound: Record<string, unknown>[] = []
    let selectedPair: Record<string, unknown> | undefined
    stats.forEach((report) => {
      if (report.type === 'outbound-rtp') {
        outbound.push({
          kind: report.kind,
          codec: byId.get(report.codecId)?.mimeType,
          packets_sent: report.packetsSent,
          bytes_sent: report.bytesSent,
          frames_encoded: report.framesEncoded,
          key_frames_encoded: report.keyFramesEncoded,
          frames_per_second: report.framesPerSecond,
          frame_size: report.frameWidth ? `${report.frameWidth}x${report.frameHeight}` : undefined,
          target_bitrate: report.targetBitrate,
          retransmitted_packets: report.retransmittedPacketsSent,
          nack_count: report.nackCount,
          pli_count: report.pliCount,
          quality_limitation_reason: report.qualityLimitationReason,
        })
      } else if (report.type === 'remote-inbound-rtp') {
        remoteInbound.push({
          kind: report.kind,
          packets_lost: report.packetsLost,
          fraction_lost: report.fractionLost,
          round_trip_time: report.roundTripTime,
        })
      } else if (report.type === 'transport' && report.selectedCandidatePairId) {
        selectedPair = byId.get(report.selectedCandidatePairId)
      }
    })
    const localCandidate = selectedPair
      ? byId.get(selectedPair.localCandidateId as string)
      : undefined
    browserLogger.info('Publisher storage stats', {
      event_name: 'publisher_storage_stats',
      at_seconds: atSeconds,
      // Stringified so the values are readable in a collapsed console line.
      outbound: JSON.stringify(outbound),
      remote_inbound: JSON.stringify(remoteInbound),
      selected_pair: JSON.stringify(
        selectedPair
          ? {
              state: selectedPair.state,
              available_outgoing_bitrate: selectedPair.availableOutgoingBitrate,
              current_round_trip_time: selectedPair.currentRoundTripTime,
              local_candidate_type: localCandidate?.candidateType,
              relay_protocol: localCandidate?.relayProtocol,
            }
          : undefined,
      ),
    })
  } catch {
    // Connection already closed; nothing to report.
  }
}

// Extracts the negotiation-relevant lines (media kinds, codecs, directions)
// so SDP problems with the storage session are visible in logs without
// shipping the whole SDP. Joined into one string so the console shows the
// values without expanding.
function summarizeSdp(sdp: string): string {
  return sdp
    .split(/\r?\n/)
    .filter(
      (line) =>
        line.startsWith('m=') ||
        line.startsWith('a=rtpmap:') ||
        line === 'a=sendonly' ||
        line === 'a=sendrecv' ||
        line === 'a=recvonly' ||
        line === 'a=inactive',
    )
    .join(' | ')
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

  // The storage session is a peer for signaling purposes but not a viewer,
  // so it is excluded from the reported peer count.
  function viewerCount() {
    return peers.size - (peers.has(STORAGE_PEER_ID) ? 1 : 0)
  }

  function closePeer(clientId: string) {
    const peer = peers.get(clientId)
    if (!peer) {
      return
    }
    peer.connection.close()
    peers.delete(clientId)
    options.onPeerCount(viewerCount())
    browserLogger.info('Publisher peer closed', {
      event_name: 'publisher_peer_closed',
      client_id: clientId,
      peer_count: viewerCount(),
    })
    if (clientId === STORAGE_PEER_ID) {
      options.onStoragePeerClosed?.()
    }
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

  signalingClient.on('statusResponse', (status: SignalingStatusResponse) => {
    if (status?.success === false) {
      browserLogger.error('Publisher signaling message rejected', {
        event_name: 'publisher_signaling_message_rejected',
        correlation_id: status.correlationId,
        error_type: status.errorType,
        status_code: status.statusCode,
        description: status.description,
      })
      options.onStatus(`Signaling message rejected: ${status.errorType ?? status.statusCode}`)
    } else {
      browserLogger.debug('Publisher signaling status response', {
        event_name: 'publisher_signaling_status_response',
        correlation_id: status?.correlationId,
      })
    }
  })

  signalingClient.on(
    'sdpOffer',
    async (offer: RTCSessionDescriptionInit, remoteClientId?: string) => {
      // Offers without a senderClientId come from the storage session (the
      // recording peer joined via JoinStorageSession); answers and ICE
      // candidates addressed to it must be sent without a recipient id.
      const isStorageSession = !remoteClientId
      const peerId = remoteClientId ?? STORAGE_PEER_ID
      const peerLabel = isStorageSession ? 'Recording session' : `Viewer ${peerId}`

      browserLogger.info('Publisher received SDP offer', {
        event_name: 'publisher_sdp_offer_received',
        client_id: peerId,
        peer_kind: isStorageSession ? 'storage' : 'viewer',
        ...(isStorageSession ? { offer_media: summarizeSdp(offer.sdp ?? '') } : {}),
      })
      try {
        closePeer(peerId)
        const connection = new RTCPeerConnection(rtcConfig)
        peers.set(peerId, { connection })
        options.onPeerCount(viewerCount())

        for (const track of options.stream.getTracks()) {
          connection.addTrack(track, options.stream)
        }

        connection.addEventListener('icecandidate', ({ candidate }) => {
          if (candidate) {
            signalingClient.sendIceCandidate(
              candidate,
              remoteClientId,
              isStorageSession ? nextCorrelationId() : undefined,
            )
          } else {
            browserLogger.debug('Publisher ICE gathering completed', {
              event_name: 'publisher_ice_gathering_completed',
              client_id: peerId,
            })
          }
        })

        connection.addEventListener('iceconnectionstatechange', () => {
          browserLogger.info('Publisher ICE connection state changed', {
            event_name: 'publisher_ice_state_changed',
            client_id: peerId,
            ice_connection_state: connection.iceConnectionState,
          })
        })

        connection.addEventListener('connectionstatechange', () => {
          const state = connection.connectionState
          browserLogger.info('Publisher peer connection state changed', {
            event_name: 'publisher_peer_state_changed',
            client_id: peerId,
            connection_state: state,
          })
          options.onStatus(`${peerLabel}: ${state}`)
          if (state === 'connected' && isStorageSession) {
            for (const atSeconds of [5, 20, 40]) {
              window.setTimeout(() => void logStorageStats(connection, atSeconds), atSeconds * 1000)
            }
          }
          // 'disconnected' is often transient and recovers on its own; give
          // the storage session that chance instead of tearing down the
          // recording immediately.
          const shouldClose = isStorageSession
            ? state === 'failed' || state === 'closed'
            : state === 'failed' || state === 'disconnected' || state === 'closed'
          if (shouldClose) {
            if (isStorageSession) {
              // Buffered candidates are keyed by client id; reset so a new
              // storage offer after reconnection starts from a clean slate.
              signalingClient.resetIceCandidateState()
            }
            closePeer(peerId)
          }
        })

        await connection.setRemoteDescription(offer)
        signalingClient.drainPendingIceCandidates(remoteClientId)

        if (isStorageSession) {
          // KVS ingestion requires the master's answer to be sendonly for
          // video (sendonly or sendrecv for audio); force sendonly so the
          // storage session cannot reject the answer over directionality.
          for (const transceiver of connection.getTransceivers()) {
            transceiver.direction = 'sendonly'
          }
        }

        const answer = await connection.createAnswer()
        await connection.setLocalDescription(answer)
        if (connection.localDescription) {
          // A correlationId makes the storage session report rejections via
          // statusResponse instead of failing silently.
          const correlationId = isStorageSession ? nextCorrelationId() : undefined
          signalingClient.sendSdpAnswer(connection.localDescription, remoteClientId, correlationId)
          browserLogger.info('Publisher sent SDP answer', {
            event_name: 'publisher_sdp_answer_sent',
            client_id: peerId,
            peer_kind: isStorageSession ? 'storage' : 'viewer',
            ...(isStorageSession
              ? {
                  correlation_id: correlationId,
                  answer_media: summarizeSdp(connection.localDescription.sdp),
                }
              : {}),
          })
        }
      } catch (caught) {
        const error = caught instanceof Error ? caught : new Error(String(caught))
        browserLogger.error(
          'Publisher failed to handle SDP offer',
          {
            event_name: 'publisher_sdp_offer_failed',
            client_id: peerId,
          },
          error,
        )
        options.onStatus(`${peerLabel}: ${error.message}`)
        closePeer(peerId)
      }
    },
  )

  signalingClient.on(
    'iceCandidate',
    async (candidate: RTCIceCandidateInit, remoteClientId?: string) => {
      const peerId = remoteClientId ?? STORAGE_PEER_ID
      const peer = peers.get(peerId)
      if (!peer) {
        browserLogger.warn('Publisher received ICE candidate for unknown peer', {
          event_name: 'publisher_ice_candidate_unknown_peer',
          client_id: peerId,
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
            client_id: peerId,
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

// Chrome's screen capture emits video frames only when the captured content
// changes, so a mostly-static screen can stall at a single frame. The KVS
// storage session cannot cut fragments out of a stalled feed, which ends in
// "no fragments found" on HLS playback even though the WebRTC connection is
// healthy. Recording-enabled lives therefore publish a canvas copy of the
// capture that is redrawn at a constant frame rate, scaled down to at most
// 720p — the resolution the official KVS ingestion samples use — to keep the
// encoder load and bitrate within what the TURN-relayed storage session
// sustains.
export function createConstantFrameRateVideoTrack(
  source: MediaStreamTrack,
  fps = 10,
): { track: MediaStreamTrack; stop: () => void } {
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.srcObject = new MediaStream([source])
  void video.play()

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')

  // A worker-driven clock keeps ticking while the publisher tab is in the
  // background (the usual case when sharing another window), where
  // main-thread timers are throttled to 1Hz or less.
  const workerUrl = URL.createObjectURL(
    new Blob([`setInterval(() => postMessage(0), ${Math.round(1000 / fps)})`], {
      type: 'application/javascript',
    }),
  )
  const worker = new Worker(workerUrl)
  worker.onmessage = () => {
    const width = video.videoWidth
    const height = video.videoHeight
    if (!width || !height || !context) {
      return
    }
    const scale = Math.min(1, 1280 / width, 720 / height)
    const targetWidth = Math.round(width * scale)
    const targetHeight = Math.round(height * scale)
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth
      canvas.height = targetHeight
    }
    context.drawImage(video, 0, 0, targetWidth, targetHeight)
  }

  const stream = canvas.captureStream(fps)
  const track = stream.getVideoTracks()[0]
  // Prefer keeping the frame rate steady over resolution when bandwidth is
  // tight; a downscaled-but-moving feed keeps KVS fragment production alive.
  track.contentHint = 'motion'
  return {
    track,
    stop() {
      worker.terminate()
      URL.revokeObjectURL(workerUrl)
      track.stop()
      video.srcObject = null
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
