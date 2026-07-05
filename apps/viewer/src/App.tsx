import {
  ArrowLeft,
  Disc,
  Globe,
  KeyRound,
  Lock,
  LogOut,
  MonitorPlay,
  Radio,
  Search,
  Square,
  Unplug,
  Video,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { createViewerSession, getLive, getPlayback, searchLives } from './api'
import { AuthGate } from './AuthGate'
import { createClientId } from './clientId'
import { HlsPlayer } from './HlsPlayer'
import { startViewer, type ViewerRuntime } from './kvsViewer'
import type { LiveSummary, PlaybackInfo } from './types'

function App() {
  return (
    <AuthGate appName="Viewer">
      {(session, onSignOut) => <Shell username={session.username} onSignOut={onSignOut} />}
    </AuthGate>
  )
}

function Shell({ username, onSignOut }: { username: string; onSignOut: () => void }) {
  const [liveId, setLiveId] = useState(
    () => new URLSearchParams(window.location.search).get('liveId') ?? '',
  )

  useEffect(() => {
    const onPopState = () => {
      setLiveId(new URLSearchParams(window.location.search).get('liveId') ?? '')
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const openLive = useCallback((id: string) => {
    const url = new URL(window.location.href)
    url.searchParams.set('liveId', id)
    window.history.pushState({}, '', url)
    setLiveId(id)
  }, [])

  const goHome = useCallback(() => {
    const url = new URL(window.location.href)
    url.searchParams.delete('liveId')
    window.history.pushState({}, '', url)
    setLiveId('')
  }, [])

  return (
    <main className="app-shell">
      <section className="workspace">
        <div className="toolbar">
          <div>
            <p className="eyebrow">Viewer</p>
            <h1>KVS live &amp; recordings</h1>
          </div>
          <div className="user-chip">
            {username}
            <button type="button" className="link" onClick={onSignOut} title="Sign out">
              <LogOut size={16} aria-hidden="true" />
            </button>
          </div>
        </div>

        {liveId ? (
          <WatchView liveId={liveId} onBack={goHome} />
        ) : (
          <HomeView onOpenLive={openLive} />
        )}
      </section>
    </main>
  )
}

function HomeView({ onOpenLive }: { onOpenLive: (id: string) => void }) {
  const [query, setQuery] = useState('')
  const [lives, setLives] = useState<LiveSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const runSearch = useCallback(async (value: string) => {
    setLoading(true)
    setError('')
    try {
      setLives(await searchLives(value))
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void runSearch('')
  }, [runSearch])

  const liveNow = lives.filter((live) => live.status === 'live')
  const recordings = lives.filter((live) => live.status !== 'live')

  return (
    <>
      <form
        className="search-bar"
        onSubmit={(event) => {
          event.preventDefault()
          void runSearch(query)
        }}
      >
        <Search size={18} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by title or username"
          aria-label="Search lives"
        />
        <button type="submit">Search</button>
      </form>

      {error && (
        <div className="error-banner" role="alert">
          <Unplug size={18} aria-hidden="true" />
          {error}
        </div>
      )}

      <section aria-label="Live now">
        <h2 className="section-title">
          <Radio size={18} aria-hidden="true" />
          Live now
        </h2>
        {loading ? (
          <p className="empty-note">Loading…</p>
        ) : liveNow.length === 0 ? (
          <p className="empty-note">Nobody is live right now</p>
        ) : (
          <div className="card-grid">
            {liveNow.map((live) => (
              <LiveCard key={live.id} live={live} onOpen={onOpenLive} />
            ))}
          </div>
        )}
      </section>

      <section aria-label="Past broadcasts">
        <h2 className="section-title">
          <Video size={18} aria-hidden="true" />
          Past broadcasts
        </h2>
        {loading ? (
          <p className="empty-note">Loading…</p>
        ) : recordings.length === 0 ? (
          <p className="empty-note">No recordings found</p>
        ) : (
          <div className="card-grid">
            {recordings.map((live) => (
              <LiveCard key={live.id} live={live} onOpen={onOpenLive} />
            ))}
          </div>
        )}
      </section>
    </>
  )
}

function LiveCard({ live, onOpen }: { live: LiveSummary; onOpen: (id: string) => void }) {
  return (
    <button type="button" className="live-card" onClick={() => onOpen(live.id)}>
      <div className="live-card-head">
        <span className={`badge ${live.status}`}>
          {live.status === 'live' ? 'LIVE' : 'REC'}
        </span>
        {live.hasPassphrase && <Lock size={14} aria-hidden="true" />}
        {live.public && <Globe size={14} aria-hidden="true" />}
        {live.record && <Disc size={14} aria-hidden="true" />}
      </div>
      <strong className="live-card-title">{live.title}</strong>
      <span className="live-card-owner">{live.ownerName}</span>
      <span className="live-card-meta">
        {formatDate(live.startedAt ?? live.createdAt)}
        {live.durationSeconds ? ` · ${formatDuration(live.durationSeconds)}` : ''}
      </span>
    </button>
  )
}

type WatchState = 'loading' | 'locked' | 'connecting' | 'watching-live' | 'watching-recording' | 'unavailable' | 'error'

function WatchView({ liveId, onBack }: { liveId: string; onBack: () => void }) {
  const clientId = useMemo(() => createClientId(), [])
  const [live, setLive] = useState<LiveSummary | null>(null)
  const [state, setState] = useState<WatchState>('loading')
  const [passphrase, setPassphrase] = useState('')
  const [playback, setPlayback] = useState<PlaybackInfo | null>(null)
  const [statusText, setStatusText] = useState('Loading live…')
  const [error, setError] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)
  const runtimeRef = useRef<ViewerRuntime | null>(null)

  const releaseViewer = useCallback(() => {
    runtimeRef.current?.stop()
    runtimeRef.current = null
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }, [])

  useEffect(() => {
    return () => {
      releaseViewer()
    }
  }, [releaseViewer])

  const startWatching = useCallback(
    async (target: LiveSummary, enteredPassphrase: string) => {
      setError('')
      if (target.status === 'live') {
        setState('connecting')
        setStatusText('Preparing viewer session')
        try {
          const session = await createViewerSession({
            liveId: target.id,
            passphrase: enteredPassphrase || undefined,
            clientId,
          })
          const runtime = await startViewer({
            liveId: target.id,
            passphrase: enteredPassphrase || undefined,
            clientId,
            session,
            onRemoteStream(stream) {
              if (videoRef.current) {
                videoRef.current.srcObject = stream
              }
              setState('watching-live')
              setStatusText('Receiving live screen')
            },
            onStatus: setStatusText,
          })
          runtimeRef.current = runtime
        } catch (caught) {
          releaseViewer()
          setState(target.hasPassphrase && !target.owned ? 'locked' : 'error')
          setError(errorMessage(caught))
        }
      } else if (target.hasRecording) {
        setState('connecting')
        setStatusText('Fetching HLS playback URL')
        try {
          const info = await getPlayback({
            liveId: target.id,
            passphrase: enteredPassphrase || undefined,
          })
          setPlayback(info)
          setState('watching-recording')
          setStatusText('Playing recording over HLS')
        } catch (caught) {
          setState(target.hasPassphrase && !target.owned ? 'locked' : 'error')
          setError(errorMessage(caught))
        }
      } else {
        setState('unavailable')
        setStatusText('This broadcast has ended and has no recording')
      }
    },
    [clientId, releaseViewer],
  )

  useEffect(() => {
    let cancelled = false
    releaseViewer()
    setPlayback(null)
    setLive(null)
    setState('loading')
    setStatusText('Loading live…')
    setError('')

    getLive(liveId)
      .then((fetched) => {
        if (cancelled) {
          return
        }
        setLive(fetched)
        if (fetched.hasPassphrase && !fetched.owned) {
          setState('locked')
        } else {
          void startWatching(fetched, '')
        }
      })
      .catch((caught) => {
        if (!cancelled) {
          setState('error')
          setError(errorMessage(caught))
        }
      })

    return () => {
      cancelled = true
    }
  }, [liveId, releaseViewer, startWatching])

  function handleUnlock(event: React.FormEvent) {
    event.preventDefault()
    if (live) {
      void startWatching(live, passphrase)
    }
  }

  function stopViewing() {
    releaseViewer()
    setState('unavailable')
    setStatusText('Viewer stopped')
  }

  return (
    <>
      <div className="watch-header">
        <button type="button" className="secondary back-button" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" />
          Back
        </button>
        {live && (
          <div className="watch-title">
            <strong>{live.title}</strong>
            <span className="muted">
              {live.ownerName}
              {live.startedAt ? ` · ${formatDate(live.startedAt)}` : ''}
              {live.status !== 'live' && live.durationSeconds
                ? ` · ${formatDuration(live.durationSeconds)}`
                : ''}
            </span>
          </div>
        )}
        <span className={`badge ${live?.status ?? ''}`}>
          {live?.status === 'live' ? 'LIVE' : live?.status === 'ended' ? 'REC' : '…'}
        </span>
      </div>

      {error && state !== 'locked' && (
        <div className="error-banner" role="alert">
          <Unplug size={18} aria-hidden="true" />
          {error}
        </div>
      )}

      {state === 'locked' && live && (
        <form className="unlock-card" onSubmit={handleUnlock}>
          <KeyRound size={22} aria-hidden="true" />
          <p>
            <strong>{live.title}</strong> is protected by a passphrase.
          </p>
          <label>
            <span>Passphrase</span>
            <input
              type="password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              placeholder="shared passphrase"
              autoComplete="off"
            />
          </label>
          {error && (
            <div className="error-banner" role="alert">
              <Unplug size={18} aria-hidden="true" />
              {error}
            </div>
          )}
          <button type="submit" disabled={!passphrase.trim()}>
            {live.status === 'live' ? 'Join live' : 'Watch recording'}
          </button>
        </form>
      )}

      {state === 'watching-recording' && playback && live ? (
        <HlsPlayer
          src={playback.hlsUrl}
          title={live.title}
          startedAt={playback.startedAt}
          live={playback.playbackMode === 'LIVE'}
          onError={setError}
        />
      ) : (
        state !== 'locked' && (
          <section className="video-panel" aria-label="Live video">
            <video ref={videoRef} autoPlay playsInline controls={state === 'watching-live'} />
            {state !== 'watching-live' && (
              <div className="empty-video">
                <MonitorPlay size={30} aria-hidden="true" />
                <span>{statusText}</span>
              </div>
            )}
            {state === 'watching-live' && (
              <button type="button" className="stop-button secondary" onClick={stopViewing}>
                <Square size={16} aria-hidden="true" />
                Stop
              </button>
            )}
          </section>
        )
      )}
    </>
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
