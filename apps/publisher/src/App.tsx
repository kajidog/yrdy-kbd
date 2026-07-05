import { Copy, MonitorUp, Radio, Square, Unplug } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import { createPublisherSession, createRoom } from './api'
import { startPublisher, type PublisherRuntime } from './kvsPublisher'
import type { CreateRoomResponse } from './types'

type BroadcastStatus = 'idle' | 'ready' | 'starting' | 'live' | 'stopped' | 'error'

function App() {
  const [passphrase, setPassphrase] = useState('')
  const [room, setRoom] = useState<CreateRoomResponse | null>(null)
  const [status, setStatus] = useState<BroadcastStatus>('idle')
  const [statusText, setStatusText] = useState('Room is not created')
  const [peerCount, setPeerCount] = useState(0)
  const [error, setError] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const runtimeRef = useRef<PublisherRuntime | null>(null)

  const releaseBroadcast = useCallback(() => {
    runtimeRef.current?.stop()
    runtimeRef.current = null
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

  async function handleCreateRoom() {
    setError('')
    setStatus('starting')
    setStatusText('Creating KVS signaling channel')
    try {
      const created = await createRoom(passphrase)
      setRoom(created)
      setStatus('ready')
      setStatusText('Room is ready')
    } catch (caught) {
      setStatus('error')
      setError(errorMessage(caught))
      setStatusText('Room creation failed')
    }
  }

  async function handleStartBroadcast() {
    if (!room) {
      return
    }

    setError('')
    setStatus('starting')
    setStatusText('Waiting for screen selection')

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
      stream.getVideoTracks()[0]?.addEventListener('ended', stopBroadcast)

      setStatusText('Preparing KVS session')
      const session = await createPublisherSession(room.roomId, passphrase)
      const runtime = await startPublisher({
        roomId: room.roomId,
        passphrase,
        session,
        stream,
        onStatus: setStatusText,
        onPeerCount: setPeerCount,
      })
      runtimeRef.current = runtime
      setStatus('live')
      setStatusText('Broadcasting screen')
    } catch (caught) {
      stopBroadcast()
      setStatus('error')
      setError(errorMessage(caught))
      setStatusText('Broadcast failed')
    }
  }

  function stopBroadcast() {
    releaseBroadcast()
    setPeerCount(0)
    setStatus((current) => (current === 'idle' || current === 'error' ? current : 'stopped'))
    setStatusText(room ? 'Broadcast stopped' : 'Room is not created')
  }

  async function copyWatchURL() {
    if (!room) {
      return
    }
    await navigator.clipboard.writeText(room.watchUrl)
    setStatusText('Watch link copied')
  }

  const canCreateRoom = passphrase.trim().length > 0 && status !== 'starting'
  const canBroadcast = Boolean(room) && status !== 'starting' && status !== 'live'
  const isLive = status === 'live'

  return (
    <main className="app-shell">
      <section className="workspace">
        <div className="toolbar">
          <div>
            <p className="eyebrow">Publisher</p>
            <h1>KVS screen broadcast</h1>
          </div>
          <div className={`status-pill ${status}`}>
            <span aria-hidden="true" />
            {statusText}
          </div>
        </div>

        <div className="main-grid">
          <section className="control-panel" aria-label="Broadcast controls">
            <label>
              <span>Passphrase</span>
              <input
                type="password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
                placeholder="viewer passphrase"
                autoComplete="off"
              />
            </label>

            <div className="button-row">
              <button type="button" onClick={handleCreateRoom} disabled={!canCreateRoom}>
                <Radio size={18} aria-hidden="true" />
                Create room
              </button>
              <button type="button" onClick={handleStartBroadcast} disabled={!canBroadcast}>
                <MonitorUp size={18} aria-hidden="true" />
                Share screen
              </button>
              <button type="button" className="secondary" onClick={stopBroadcast} disabled={!isLive}>
                <Square size={18} aria-hidden="true" />
                Stop
              </button>
            </div>

            {room && (
              <div className="room-details">
                <div>
                  <span>Room</span>
                  <strong>{room.roomId}</strong>
                </div>
                <div>
                  <span>Viewers</span>
                  <strong>{peerCount}</strong>
                </div>
                <button type="button" className="copy-button" onClick={copyWatchURL} title="Copy watch link">
                  <Copy size={18} aria-hidden="true" />
                  Copy watch link
                </button>
              </div>
            )}

            {error && (
              <div className="error-banner" role="alert">
                <Unplug size={18} aria-hidden="true" />
                {error}
              </div>
            )}
          </section>

          <section className="preview-panel" aria-label="Screen preview">
            <video ref={videoRef} autoPlay muted playsInline />
            {!isLive && (
              <div className="empty-preview">
                <MonitorUp size={28} aria-hidden="true" />
                <span>Screen preview</span>
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
