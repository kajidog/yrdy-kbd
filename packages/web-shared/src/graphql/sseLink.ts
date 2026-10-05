import { ApolloLink, Observable, type FetchResult, type Operation } from '@apollo/client'
import { print } from 'graphql'
import { createClient, type Client, type ClientOptions } from 'graphql-sse'

// SSELink is an ApolloLink that runs operations over graphql-sse (distinct
// connections mode: one SSE connection per subscription). It plays the role
// GraphQLWsLink plays for graphql-ws, so useSubscription works unchanged.
export class SSELink extends ApolloLink {
  private readonly client: Client

  constructor(options: ClientOptions) {
    super()
    this.client = createClient(options)
  }

  override request(operation: Operation): Observable<FetchResult> {
    return new Observable<FetchResult>((observer) =>
      // subscribe returns the unsubscribe function, which closes the SSE
      // connection when Apollo tears the observable down.
      this.client.subscribe<FetchResult>(
        {
          query: print(operation.query),
          variables: operation.variables,
          operationName: operation.operationName,
          extensions: operation.extensions,
        },
        {
          next: (result) => observer.next(result as FetchResult),
          complete: () => observer.complete(),
          error: (caught) =>
            observer.error(caught instanceof Error ? caught : new Error(String(caught))),
        },
      ),
    )
  }

  dispose() {
    this.client.dispose()
  }
}
