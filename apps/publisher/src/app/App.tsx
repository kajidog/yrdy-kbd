import { ApolloProvider } from '@apollo/client'
import { AuthGate, createApolloClient } from '@yrdy-kbd/web-shared'
import { Dashboard } from '../features/dashboard/Dashboard'
import './App.css'

const apolloClient = createApolloClient()

function App() {
  return (
    <ApolloProvider client={apolloClient}>
      <AuthGate appName="Publisher">
        {(session, onSignOut) => <Dashboard session={session} onSignOut={onSignOut} />}
      </AuthGate>
    </ApolloProvider>
  )
}

export default App
