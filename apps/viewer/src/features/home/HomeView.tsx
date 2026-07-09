import { errorMessage } from '@yrdy-kbd/web-shared'
import { Radio, Search, Unplug, Video } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { searchLives, type LiveSummary } from '../../graphql/operations'
import { LiveCard } from './LiveCard'

export function HomeView({ onOpenLive }: { onOpenLive: (id: string) => void }) {
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

  const liveNow = lives.filter((live) => live.status === 'LIVE')
  const recordings = lives.filter((live) => live.status !== 'LIVE')

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
