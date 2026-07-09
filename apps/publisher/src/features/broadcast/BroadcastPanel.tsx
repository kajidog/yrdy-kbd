import { Copy, MonitorUp, Radio, Square, Unplug } from 'lucide-react'
import type { RefObject } from 'react'
import type { LiveSummary } from '../../graphql/operations'

type BroadcastPanelProps = {
  selected: LiveSummary | null
  isLive: boolean
  canBroadcast: boolean
  peerCount: number
  error: string
  videoRef: RefObject<HTMLVideoElement | null>
  onStart: () => void
  onStop: () => void
  onCopyWatchURL: (live: LiveSummary) => void
}

export function BroadcastPanel({
  selected,
  isLive,
  canBroadcast,
  peerCount,
  error,
  videoRef,
  onStart,
  onStop,
  onCopyWatchURL,
}: BroadcastPanelProps) {
  return (
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
            <button type="button" className="secondary" onClick={() => onCopyWatchURL(selected)}>
              <Copy size={16} aria-hidden="true" />
              Watch link
            </button>
          )}
          <button type="button" onClick={onStart} disabled={!canBroadcast}>
            {isLive ? <Radio size={18} aria-hidden="true" /> : <MonitorUp size={18} aria-hidden="true" />}
            Go live
          </button>
          <button type="button" className="secondary" onClick={onStop} disabled={!isLive}>
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
  )
}
