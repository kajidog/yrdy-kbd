import type { DocumentTypeDecoration } from '@graphql-typed-document-node/core'
import { getIdToken } from '../auth/auth'

const bffBaseURL = import.meta.env.VITE_BFF_BASE_URL ?? 'http://localhost:8080'

export class GraphQLRequestError extends Error {}

type GraphQLResponse<TResult> = {
  data?: TResult | null
  errors?: { message: string }[]
}

// executeGraphQL posts a codegen-typed document (the `graphql()` tagged
// operations generated into each app's src/gql) to the BFF's /graphql
// endpoint with the caller's ID token attached.
export async function executeGraphQL<TResult, TVariables>(
  document: DocumentTypeDecoration<TResult, TVariables> & { toString(): string },
  variables?: TVariables,
): Promise<TResult> {
  const token = await getIdToken()
  const response = await fetch(`${bffBaseURL}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query: document.toString(), variables }),
  })

  let payload: GraphQLResponse<TResult>
  try {
    payload = (await response.json()) as GraphQLResponse<TResult>
  } catch {
    throw new GraphQLRequestError(`GraphQL request failed with ${response.status}`)
  }
  if (payload.errors?.length) {
    throw new GraphQLRequestError(payload.errors[0].message)
  }
  if (!response.ok || payload.data == null) {
    throw new GraphQLRequestError(`GraphQL request failed with ${response.status}`)
  }
  return payload.data
}
