import { ApolloClient, HttpLink, InMemoryCache, split } from '@apollo/client'
import { setContext } from '@apollo/client/link/context'
import { getMainDefinition } from '@apollo/client/utilities'
import { getIdToken } from '../auth/auth'
import { SSELink } from './sseLink'

const bffBaseURL = import.meta.env.VITE_BFF_BASE_URL ?? 'http://localhost:8080'

// createApolloClient builds an Apollo Client that talks to the BFF's
// /graphql endpoint with the caller's ID token attached, like executeGraphQL.
// Queries and mutations go over plain HTTP; subscriptions go over SSE.
export function createApolloClient() {
  const authLink = setContext(async (_, { headers }) => ({
    headers: {
      ...headers,
      Authorization: `Bearer ${await getIdToken()}`,
      'X-Request-ID': crypto.randomUUID(),
    },
  }))
  const httpLink = new HttpLink({ uri: `${bffBaseURL}/graphql` })
  const sseLink = new SSELink({
    url: `${bffBaseURL}/graphql`,
    headers: async () => ({
      Authorization: `Bearer ${await getIdToken()}`,
      'X-Request-ID': crypto.randomUUID(),
    }),
  })

  return new ApolloClient({
    link: split(
      ({ query }) => {
        const definition = getMainDefinition(query)
        return (
          definition.kind === 'OperationDefinition' && definition.operation === 'subscription'
        )
      },
      sseLink,
      authLink.concat(httpLink),
    ),
    cache: new InMemoryCache(),
  })
}
