import { errorMessage, formatDate, formatDuration } from '@yrdy-kbd/web-shared'
import { ArrowLeft, KeyRound, MonitorPlay, Square, Unplug } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HlsPlayer } from '../../components/HlsPlayer'
import {
  createViewerSession,
  getLive,
  getPlayback,
  signSignalingUrl,
  type LiveSummary,
  type PlaybackInfo,
} from '../../graphql/operations'
import { createClientId } from '../../lib/clientId'
import { startViewer, type ViewerRuntime } from '../../lib/kvsViewer'

type WatchState =
  | 'loading'
  | 'locked'
  | 'connecting'
  | 'watching-live'
  | 'watching-recording'
  | 'unavailable'
  | 'error'

export function WatchView({ liveId, onBack }: { liveId: string; onBack: () => void }) {
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
      if (target.status === 'LIVE') {
        setState('connecting')
        setStatusText('Preparing viewer session')
        try {
          const session = await createViewerSession({
            liveId: target.id,
            passphrase: enteredPassphrase || undefined,
            clientId,
          })
          const runtime = await startViewer({
            clientId,
            session,
            signUrl: async (endpoint, queryParams) =>
              signSignalingUrl({
                liveId: target.id,
                role: 'VIEWER',
                clientId,
                passphrase: enteredPassphrase || null,
                endpoint,
                queryParams,
              }),
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
              {live.status !== 'LIVE' && live.durationSeconds
                ? ` · ${formatDuration(live.durationSeconds)}`
                : ''}
            </span>
          </div>
        )}
        <span className={`badge ${live?.status.toLowerCase() ?? ''}`}>
          {live?.status === 'LIVE' ? 'LIVE' : live?.status === 'ENDED' ? 'REC' : '…'}
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
            {live.status === 'LIVE' ? 'Join live' : 'Watch recording'}
          </button>
        </form>
      )}

      {state === 'watching-recording' && playback && live ? (
        <HlsPlayer
          src={playback.hlsUrl}
          title={live.title}
          startedAt={playback.startedAt ?? undefined}
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
