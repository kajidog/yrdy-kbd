import { AuthGate } from '@yrdy-kbd/web-shared'
import { Dashboard } from '../features/dashboard/Dashboard'
import './App.css'

function App() {
  return (
    <AuthGate appName="Publisher">
      {(session, onSignOut) => <Dashboard session={session} onSignOut={onSignOut} />}
    </AuthGate>
  )
}

export default App
