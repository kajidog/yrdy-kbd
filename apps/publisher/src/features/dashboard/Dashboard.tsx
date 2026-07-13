import { errorMessage, type AuthSession } from '@yrdy-kbd/web-shared'
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
    setSelectedId(live.id)
    setStatusText('Live is ready to broadcast')
    await refreshLives()
  }

  async function handleStartBroadcast() {
    if (!selected || status === 'live' || status === 'starting') {
      return
    }
    const live = selected

    setError('')
    setStatus('starting')
    setStatusText('Waiting for screen selection')

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      })
      if (live.record && stream.getAudioTracks().length === 0) {
        const silent = createSilentAudioTrack()
        silentAudioRef.current = silent
        stream.addTrack(silent.track)
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
        onSignalingOpen: live.record
          ? () => {
              setStatusText('Starting recording session')
              joinStorageSession(live.id)
                .then(() => setStatusText('Recording to Kinesis Video Streams'))
                .catch((caught) => setError(`Recording failed: ${errorMessage(caught)}`))
            }
          : undefined,
      })
      runtimeRef.current = runtime
      broadcastingIdRef.current = live.id
      setStatus('live')
      setStatusText('Broadcasting screen')
      await refreshLives()
    } catch (caught) {
      releaseBroadcast()
      setStatus('error')
      setError(errorMessage(caught))
      setStatusText('Broadcast failed')
    }
  }

  async function handleStopBroadcast() {
    const liveId = broadcastingIdRef.current
    broadcastingIdRef.current = ''
    releaseBroadcast()
    setPeerCount(0)
    setStatus('idle')
    setStatusText('Broadcast stopped')
    if (liveId) {
      try {
        await stopLive(liveId)
      } catch (caught) {
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
