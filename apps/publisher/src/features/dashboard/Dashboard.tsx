import { browserLogger, errorMessage, type AuthSession } from '@yrdy-kbd/web-shared'
import { LogOut } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createPublisherSession,
  joinStorageSession,
  listMyLives,
  signSignalingUrl,
  stopLive,
  type LiveSummary,
} from '../../graphql/operations'
import { createSilentAudioTrack, startPublisher, type PublisherRuntime } from '../../lib/kvsPublisher'
import { BroadcastPanel } from '../broadcast/BroadcastPanel'
import { CreateLivePanel } from '../lives/CreateLivePanel'
import { MyLivesPanel } from '../lives/MyLivesPanel'

export type BroadcastStatus = 'idle' | 'starting' | 'live' | 'error'

export function Dashboard({ session, onSignOut }: { session: AuthSession; onSignOut: () => void }) {
  const [lives, setLives] = useState<LiveSummary[]>([])
  const [selectedId, setSelectedId] = useState('')

  const [status, setStatus] = useState<BroadcastStatus>('idle')
  const [statusText, setStatusText] = useState('Select or create a live')
  const [peerCount, setPeerCount] = useState(0)
  const [error, setError] = useState('')

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const runtimeRef = useRef<PublisherRuntime | null>(null)
  const silentAudioRef = useRef<{ stop: () => void } | null>(null)
  const broadcastingIdRef = useRef('')

  const selected = lives.find((live) => live.id === selectedId) ?? null

  const refreshLives = useCallback(async () => {
    try {
      setLives(await listMyLives())
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }, [])

  useEffect(() => {
    void refreshLives()
  }, [refreshLives])

  const releaseBroadcast = useCallback(() => {
    runtimeRef.current?.stop()
    runtimeRef.current = null
    silentAudioRef.current?.stop()
    silentAudioRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }, [])

  useEffect(() => {
    return () => {
      releaseBroadcast()
    }
  }, [releaseBroadcast])

  async function handleCreated(live: LiveSummary) {
    browserLogger.info('Live created', {
      event_name: 'live_created',
      live_id: live.id,
      recording_enabled: live.record,
      visibility: live.public ? 'public' : 'private',
    })
    setSelectedId(live.id)
    setStatusText('Live is ready to broadcast')
    await refreshLives()
  }

  async function handleStartBroadcast() {
    if (!selected || status === 'live' || status === 'starting') {
      return
    }
    const live = selected

    browserLogger.info('Broadcast start requested', {
      event_name: 'broadcast_start_requested',
      live_id: live.id,
      recording_enabled: live.record,
    })

    setError('')
    setStatus('starting')
    setStatusText('Waiting for screen selection')

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      })
      browserLogger.info('Display capture granted', {
        event_name: 'display_capture_granted',
        live_id: live.id,
        video_track_count: stream.getVideoTracks().length,
        audio_track_count: stream.getAudioTracks().length,
      })
      if (live.record && stream.getAudioTracks().length === 0) {
        const silent = createSilentAudioTrack()
        silentAudioRef.current = silent
        stream.addTrack(silent.track)
        browserLogger.info('Silent recording audio track added', {
          event_name: 'silent_audio_track_added',
          live_id: live.id,
        })
      }
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
      stream.getVideoTracks()[0]?.addEventListener('ended', () => void handleStopBroadcast())

      setStatusText('Preparing KVS session')
      const sessionConfig = await createPublisherSession(live.id)
      const runtime = await startPublisher({
        session: sessionConfig,
        signUrl: async (endpoint, queryParams) =>
          signSignalingUrl({ liveId: live.id, role: 'MASTER', endpoint, queryParams }),
        stream,
        onStatus: setStatusText,
        onPeerCount: setPeerCount,
        onSignalingOpen: () => {
          browserLogger.info('Broadcast connected', {
            event_name: 'broadcast_connected',
            live_id: live.id,
            recording_enabled: live.record,
          })
          if (live.record) {
            browserLogger.info('Recording session start requested', {
              event_name: 'recording_session_start_requested',
              live_id: live.id,
            })
            setStatusText('Starting recording session')
            joinStorageSession(live.id)
              .then(() => {
                browserLogger.info('Recording session started', {
                  event_name: 'recording_session_started',
                  live_id: live.id,
                })
                setStatusText('Recording to Kinesis Video Streams')
              })
              .catch((caught) => {
                const caughtError = caught instanceof Error ? caught : new Error(String(caught))
                browserLogger.error(
                  'Recording session failed',
                  {
                    event_name: 'recording_session_failed',
                    live_id: live.id,
                  },
                  caughtError,
                )
                setError(`Recording failed: ${errorMessage(caught)}`)
              })
          }
        },
      })
      runtimeRef.current = runtime
      broadcastingIdRef.current = live.id
      setStatus('live')
      setStatusText('Broadcasting screen')
      browserLogger.info('Broadcast started', {
        event_name: 'broadcast_started',
        live_id: live.id,
        recording_enabled: live.record,
      })
      await refreshLives()
    } catch (caught) {
      const caughtError = caught instanceof Error ? caught : new Error(String(caught))
      browserLogger.error(
        'Broadcast start failed',
        {
          event_name: 'broadcast_start_failed',
          live_id: live.id,
        },
        caughtError,
      )
      releaseBroadcast()
      setStatus('error')
      setError(errorMessage(caught))
      setStatusText('Broadcast failed')
    }
  }

  async function handleStopBroadcast() {
    const liveId = broadcastingIdRef.current
    if (liveId) {
      browserLogger.info('Broadcast stop requested', {
        event_name: 'broadcast_stop_requested',
        live_id: liveId,
        peer_count: peerCount,
      })
    }
    broadcastingIdRef.current = ''
    releaseBroadcast()
    setPeerCount(0)
    setStatus('idle')
    setStatusText('Broadcast stopped')
    if (liveId) {
      try {
        await stopLive(liveId)
        browserLogger.info('Broadcast stopped', {
          event_name: 'broadcast_stopped',
          live_id: liveId,
        })
      } catch (caught) {
        const caughtError = caught instanceof Error ? caught : new Error(String(caught))
        browserLogger.error(
          'Broadcast stop failed',
          {
            event_name: 'broadcast_stop_failed',
            live_id: liveId,
          },
          caughtError,
        )
        setError(errorMessage(caught))
      }
      await refreshLives()
    }
  }

  async function copyWatchURL(live: LiveSummary) {
    await navigator.clipboard.writeText(live.watchUrl)
    setStatusText('Watch link copied')
  }

  const isLive = status === 'live'
  const canBroadcast =
    selected !== null && selected.status !== 'ENDED' && !isLive && status !== 'starting'

  return (
    <main className="app-shell">
      <section className="workspace">
        <div className="toolbar">
          <div>
            <p className="eyebrow">Publisher</p>
            <h1>KVS screen broadcast</h1>
          </div>
          <div className="toolbar-side">
            <div className={`status-pill ${status}`}>
              <span aria-hidden="true" />
              {statusText}
            </div>
            <div className="user-chip">
              {session.username}
              <button type="button" className="link" onClick={onSignOut} title="Sign out">
                <LogOut size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        <div className="main-grid">
          <div className="side-column">
            <CreateLivePanel onCreated={handleCreated} onError={setError} />
            <MyLivesPanel
              lives={lives}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onRefresh={() => void refreshLives()}
            />
          </div>

          <BroadcastPanel
            selected={selected}
            isLive={isLive}
            canBroadcast={canBroadcast}
            peerCount={peerCount}
            error={error}
            videoRef={videoRef}
            onStart={() => void handleStartBroadcast()}
            onStop={() => void handleStopBroadcast()}
            onCopyWatchURL={(live) => void copyWatchURL(live)}
          />
        </div>
      </section>
    </main>
  )
}
