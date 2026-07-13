import { formatDate, formatDuration } from '@yrdy-kbd/web-shared'
import { Disc, Globe, Lock } from 'lucide-react'
import type { LiveSummary } from '../../graphql/operations'

export function LiveCard({ live, onOpen }: { live: LiveSummary; onOpen: (id: string) => void }) {
  return (
    <button type="button" className="live-card" onClick={() => onOpen(live.id)}>
      <div className="live-card-head">
        <span className={`badge ${live.status.toLowerCase()}`}>
          {live.status === 'LIVE' ? 'LIVE' : 'REC'}
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
