import { AuthGate } from '@yrdy-kbd/web-shared'
import { LogOut } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { HomeView } from '../features/home/HomeView'
import { WatchView } from '../features/watch/WatchView'
import './App.css'

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

export default App
