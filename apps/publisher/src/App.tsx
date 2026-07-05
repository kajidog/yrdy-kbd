import {
  Copy,
  Disc,
  Globe,
  Lock,
  LogOut,
  MonitorUp,
  Plus,
  Radio,
  RefreshCw,
  Square,
  Unplug,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import { createLive, createPublisherSession, joinStorageSession, listMyLives, stopLive } from './api'
import { AuthGate } from './AuthGate'
import type { AuthSession } from './auth'
import { createSilentAudioTrack, startPublisher, type PublisherRuntime } from './kvsPublisher'
import type { LiveSummary } from './types'

type BroadcastStatus = 'idle' | 'starting' | 'live' | 'error'

function App() {
  return (
    <AuthGate appName="Publisher">
      {(session, onSignOut) => <Dashboard session={session} onSignOut={onSignOut} />}
    </AuthGate>
  )
}

function Dashboard({ session, onSignOut }: { session: AuthSession; onSignOut: () => void }) {
  const [lives, setLives] = useState<LiveSummary[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [title, setTitle] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [isPublic, setIsPublic] = useState(true)
  const [record, setRecord] = useState(true)
  const [creating, setCreating] = useState(false)

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

  async function handleCreateLive(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setCreating(true)
    try {
      const created = await createLive({
        title,
        passphrase: passphrase || undefined,
        public: isPublic,
        record,
      })
      setTitle('')
      setPassphrase('')
      setSelectedId(created.id)
      setStatusText('Live is ready to broadcast')
      await refreshLives()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setCreating(false)
    }
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
        liveId: live.id,
        session: sessionConfig,
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
  const canBroadcast = selected !== null && selected.status !== 'ended' && !isLive && status !== 'starting'

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
            <section className="control-panel" aria-label="Create live">
              <h2>New live</h2>
              <form className="live-form" onSubmit={handleCreateLive}>
                <label>
                  <span>Title</span>
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="What are you streaming?"
                    maxLength={120}
                  />
                </label>
                <label>
                  <span>Passphrase (optional)</span>
                  <input
                    type="password"
                    value={passphrase}
                    onChange={(event) => setPassphrase(event.target.value)}
                    placeholder="leave empty for open access"
                    autoComplete="off"
                  />
                </label>
                <div className="toggle-row">
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={isPublic}
                      onChange={(event) => setIsPublic(event.target.checked)}
                    />
                    <Globe size={16} aria-hidden="true" />
                    <span>Public (listed in search)</span>
                  </label>
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={record}
                      onChange={(event) => setRecord(event.target.checked)}
                    />
                    <Disc size={16} aria-hidden="true" />
                    <span>Record (watch later over HLS)</span>
                  </label>
                </div>
                <button type="submit" disabled={creating || !title.trim()}>
                  <Plus size={18} aria-hidden="true" />
                  Create live
                </button>
              </form>
            </section>

            <section className="control-panel" aria-label="My lives">
              <div className="panel-heading">
                <h2>My lives</h2>
                <button type="button" className="icon-button" onClick={() => void refreshLives()} title="Refresh">
                  <RefreshCw size={16} aria-hidden="true" />
                </button>
              </div>
              {lives.length === 0 && <p className="empty-note">No lives yet</p>}
              <ul className="live-list">
                {lives.map((live) => (
                  <li key={live.id}>
                    <button
                      type="button"
                      className={`live-item ${live.id === selectedId ? 'selected' : ''}`}
                      onClick={() => setSelectedId(live.id)}
                    >
                      <div className="live-item-top">
                        <strong>{live.title}</strong>
                        <span className={`badge ${live.status}`}>{live.status}</span>
                      </div>
                      <div className="live-item-meta">
                        {live.hasPassphrase && <Lock size={13} aria-hidden="true" />}
                        {live.public ? <Globe size={13} aria-hidden="true" /> : null}
                        {live.record && <Disc size={13} aria-hidden="true" />}
                        <span>{formatDate(live.startedAt ?? live.createdAt)}</span>
                        {live.durationSeconds ? <span>{formatDuration(live.durationSeconds)}</span> : null}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <section className="preview-panel" aria-label="Broadcast">
            <div className="broadcast-bar">
              <div className="broadcast-info">
                {selected ? (
                  <>
                    <strong>{selected.title}</strong>
                    <span className="muted">
                      {selected.public ? 'public' : 'unlisted'}
                      {selected.hasPassphrase ? ' · passphrase' : ''}
                      {selected.record ? ' · recorded' : ''}
                    </span>
                  </>
                ) : (
                  <span className="muted">Select a live to broadcast</span>
                )}
              </div>
              <div className="broadcast-actions">
                {selected && (
                  <button type="button" className="secondary" onClick={() => void copyWatchURL(selected)}>
                    <Copy size={16} aria-hidden="true" />
                    Watch link
                  </button>
                )}
                <button type="button" onClick={() => void handleStartBroadcast()} disabled={!canBroadcast}>
                  {isLive ? <Radio size={18} aria-hidden="true" /> : <MonitorUp size={18} aria-hidden="true" />}
                  Go live
                </button>
                <button type="button" className="secondary" onClick={() => void handleStopBroadcast()} disabled={!isLive}>
                  <Square size={18} aria-hidden="true" />
                  Stop
                </button>
              </div>
            </div>

            <div className="preview-stage">
              <video ref={videoRef} autoPlay muted playsInline />
              {!isLive && (
                <div className="empty-preview">
                  <MonitorUp size={28} aria-hidden="true" />
                  <span>Screen preview</span>
                </div>
              )}
              {isLive && (
                <div className="live-overlay">
                  <span className="live-dot" aria-hidden="true" />
                  LIVE · {peerCount} viewer{peerCount === 1 ? '' : 's'}
                </div>
              )}
            </div>

            {error && (
              <div className="error-banner" role="alert">
                <Unplug size={18} aria-hidden="true" />
                {error}
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  )
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unexpected error'
}

export default App
