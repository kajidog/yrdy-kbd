import { formatDate, formatDuration } from '@yrdy-kbd/web-shared'
import { Disc, Globe, Lock, RefreshCw } from 'lucide-react'
import type { LiveSummary } from '../../graphql/operations'

type MyLivesPanelProps = {
  lives: LiveSummary[]
  selectedId: string
  onSelect: (id: string) => void
  onRefresh: () => void
}

export function MyLivesPanel({ lives, selectedId, onSelect, onRefresh }: MyLivesPanelProps) {
  return (
    <section className="control-panel" aria-label="My lives">
      <div className="panel-heading">
        <h2>My lives</h2>
        <button type="button" className="icon-button" onClick={onRefresh} title="Refresh">
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
              onClick={() => onSelect(live.id)}
            >
              <div className="live-item-top">
                <strong>{live.title}</strong>
                <span className={`badge ${live.status.toLowerCase()}`}>
                  {live.status.toLowerCase()}
                </span>
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
  )
}
