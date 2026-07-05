import { Eye, LogIn, MonitorPlay, Square, Unplug } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { createViewerSession } from './api'
import { createClientId } from './clientId'
import { startViewer, type ViewerRuntime } from './kvsViewer'

type ViewerStatus = 'idle' | 'connecting' | 'watching' | 'stopped' | 'error'

function App() {
  const initialRoomId = new URLSearchParams(window.location.search).get('roomId') ?? ''
  const clientId = useMemo(() => createClientId(), [])
  const [roomId, setRoomId] = useState(initialRoomId)
  const [passphrase, setPassphrase] = useState('')
  const [status, setStatus] = useState<ViewerStatus>('idle')
  const [statusText, setStatusText] = useState('Waiting for room')
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

  async function handleJoin() {
    const trimmedRoomId = roomId.trim()
    if (!trimmedRoomId) {
      return
    }

    setError('')
    setStatus('connecting')
    setStatusText('Preparing viewer session')

    try {
      const session = await createViewerSession({
        roomId: trimmedRoomId,
        passphrase,
        clientId,
      })
      const runtime = await startViewer({
        roomId: trimmedRoomId,
        passphrase,
        clientId,
        session,
        onRemoteStream(stream) {
          if (videoRef.current) {
            videoRef.current.srcObject = stream
          }
          setStatus('watching')
          setStatusText('Receiving live screen')
        },
        onStatus: setStatusText,
      })
      runtimeRef.current = runtime
    } catch (caught) {
      stopViewing()
      setStatus('error')
      setError(errorMessage(caught))
      setStatusText('Viewer connection failed')
    }
  }

  function stopViewing() {
    releaseViewer()
    setStatus((current) => (current === 'idle' || current === 'error' ? current : 'stopped'))
    setStatusText('Viewer stopped')
  }

  const canJoin = roomId.trim().length > 0 && passphrase.trim().length > 0 && status !== 'connecting'
  const isWatching = status === 'watching'

  return (
    <main className="app-shell">
      <section className="workspace">
        <div className="toolbar">
          <div>
            <p className="eyebrow">Viewer</p>
            <h1>KVS live screen</h1>
          </div>
          <div className={`status-pill ${status}`}>
            <span aria-hidden="true" />
            {statusText}
          </div>
        </div>

        <div className="main-grid">
          <section className="viewer-panel" aria-label="Join controls">
            <label>
              <span>Room ID</span>
              <input
                value={roomId}
                onChange={(event) => setRoomId(event.target.value)}
                placeholder="room id"
                autoComplete="off"
              />
            </label>

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

            <div className="button-row">
              <button type="button" onClick={handleJoin} disabled={!canJoin}>
                <LogIn size={18} aria-hidden="true" />
                Join live
              </button>
              <button type="button" className="secondary" onClick={stopViewing} disabled={!isWatching}>
                <Square size={18} aria-hidden="true" />
                Stop
              </button>
            </div>

            <div className="client-box">
              <Eye size={18} aria-hidden="true" />
              <span>{clientId}</span>
            </div>

            {error && (
              <div className="error-banner" role="alert">
                <Unplug size={18} aria-hidden="true" />
                {error}
              </div>
            )}
          </section>

          <section className="video-panel" aria-label="Live video">
            <video ref={videoRef} autoPlay playsInline controls />
            {!isWatching && (
              <div className="empty-video">
                <MonitorPlay size={30} aria-hidden="true" />
                <span>Live screen</span>
              </div>
            )}
          </section>
        </div>
      </section>
    </main>
  )
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unexpected error'
}

export default App
