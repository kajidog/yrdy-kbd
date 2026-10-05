import { useQuery } from '@apollo/client'
import { errorMessage } from '@yrdy-kbd/web-shared'
import { MyLives, type LiveSummary } from '../../graphql/operations'

const pollIntervalMs = 5_000
const confirmTimeoutMs = 10_000
const confirmIntervalMs = 1_000

// useMyLives keeps the caller's lives fresh by polling the myLives query.
export function useMyLives() {
  const { data, error, refetch } = useQuery(MyLives, {
    pollInterval: pollIntervalMs,
  })

  return {
    lives: data?.myLives ?? [],
    error: error ? errorMessage(error) : '',
    refetch,
  }
}

// waitForLives refetches myLives until predicate holds, for up to 10 seconds.
// Used after a mutation to confirm the backend has reflected the change.
export async function waitForLives(
  refetch: ReturnType<typeof useMyLives>['refetch'],
  predicate: (lives: LiveSummary[]) => boolean,
): Promise<LiveSummary[]> {
  const deadline = Date.now() + confirmTimeoutMs
  for (;;) {
    const { data } = await refetch()
    if (data && predicate(data.myLives)) {
      return data.myLives
    }
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for the live list to update')
    }
    await new Promise((resolve) => setTimeout(resolve, confirmIntervalMs))
  }
}
