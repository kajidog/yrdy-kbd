import { ApolloClient, HttpLink, InMemoryCache } from '@apollo/client'
import { setContext } from '@apollo/client/link/context'
import { getIdToken } from '../auth/auth'

const bffBaseURL = import.meta.env.VITE_BFF_BASE_URL ?? 'http://localhost:8080'

// createApolloClient builds an Apollo Client that talks to the BFF's
// /graphql endpoint with the caller's ID token attached, like executeGraphQL.
export function createApolloClient() {
  const authLink = setContext(async (_, { headers }) => ({
    headers: {
      ...headers,
      Authorization: `Bearer ${await getIdToken()}`,
      'X-Request-ID': crypto.randomUUID(),
    },
  }))
  const httpLink = new HttpLink({ uri: `${bffBaseURL}/graphql` })

  return new ApolloClient({
    link: authLink.concat(httpLink),
    cache: new InMemoryCache(),
  })
}
