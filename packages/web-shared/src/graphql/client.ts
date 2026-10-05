import type { DocumentTypeDecoration } from '@graphql-typed-document-node/core'
import { print, type DocumentNode } from 'graphql'
import { getIdToken } from '../auth/auth'
import { browserLogger } from '../logging/logger'

const bffBaseURL = import.meta.env.VITE_BFF_BASE_URL ?? 'http://localhost:8080'

export class GraphQLRequestError extends Error {}

type GraphQLResponse<TResult> = {
  data?: TResult | null
  errors?: { message: string }[]
}

// executeGraphQL posts a codegen-typed document (the `graphql()` tagged
// operations generated into each app's src/gql) to the BFF's /graphql
// endpoint with the caller's ID token attached. It accepts both string-mode
// documents and DocumentNodes (the form Apollo Client consumes).
export async function executeGraphQL<TResult, TVariables>(
  document: DocumentTypeDecoration<TResult, TVariables> & ({ toString(): string } | DocumentNode),
  variables?: TVariables,
): Promise<TResult> {
  const query = isDocumentNode(document) ? print(document) : document.toString()
  const requestID = crypto.randomUUID()
  const token = await getIdToken()
  let response: Response
  try {
    response = await fetch(`${bffBaseURL}/graphql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Request-ID': requestID,
      },
      body: JSON.stringify({ query, variables }),
    })
  } catch (caught) {
    const error = caught instanceof Error ? caught : new Error(String(caught))
    browserLogger.error(
      'GraphQL network request failed',
      {
        event_name: 'graphql_request_failed',
        request_id: requestID,
      },
      error,
    )
    throw caught
  }

  let payload: GraphQLResponse<TResult>
  try {
    payload = (await response.json()) as GraphQLResponse<TResult>
  } catch (caught) {
    const error = new GraphQLRequestError(`GraphQL request failed with ${response.status}`)
    browserLogger.error(
      'GraphQL response decoding failed',
      {
        event_name: 'graphql_response_decode_failed',
        request_id: requestID,
        'http.status_code': response.status,
      },
      caught instanceof Error ? caught : error,
    )
    throw error
  }
  if (payload.errors?.length) {
    const error = new GraphQLRequestError(payload.errors[0].message)
    browserLogger.error(
      'GraphQL operation failed',
      {
        event_name: 'graphql_operation_failed',
        request_id: requestID,
        'http.status_code': response.status,
      },
      error,
    )
    throw error
  }
  if (!response.ok || payload.data == null) {
    const error = new GraphQLRequestError(`GraphQL request failed with ${response.status}`)
    browserLogger.error(
      'GraphQL request failed',
      {
        event_name: 'graphql_request_failed',
        request_id: requestID,
        'http.status_code': response.status,
      },
      error,
    )
    throw error
  }
  return payload.data
}

function isDocumentNode(document: object): document is DocumentNode {
  return (document as Partial<DocumentNode>).kind === 'Document'
}
