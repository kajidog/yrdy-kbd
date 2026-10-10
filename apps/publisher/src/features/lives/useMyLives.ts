import { useSubscription } from '@apollo/client'
import { errorMessage } from '@yrdy-kbd/web-shared'
import { useCallback, useRef } from 'react'
import { MyLivesUpdates, type LiveSummary } from '../../graphql/operations'

const confirmTimeoutMs = 10_000

// useMyLives subscribes to the caller's lives over SSE. The BFF polls on its
// side and pushes the full list on every tick, so the latest event is the
// current state.
export function useMyLives() {
  const latestRef = useRef<LiveSummary[] | null>(null)
  const waitersRef = useRef(new Set<(lives: LiveSummary[]) => void>())

  const { data, error, restart } = useSubscription(MyLivesUpdates, {
    onData: ({ data }) => {
      const lives = data.data?.myLives
      if (!lives) {
        return
      }
      latestRef.current = lives
      waitersRef.current.forEach((notify) => notify(lives))
    },
    // The BFF ends the stream when the ID token expires or the server shuts
    // down; resubscribe so a fresh token (and a live server) is used.
    onComplete: (): void => restart(),
  })

  // waitFor resolves once a pushed list satisfies predicate, for up to 10
  // seconds. Used after a mutation to confirm the backend has reflected the
  // change; the predicate checks the expected state, so the latest list is
  // checked first and nothing is missed if the event arrived early.
  const waitFor = useCallback(
    (predicate: (lives: LiveSummary[]) => boolean) =>
      new Promise<LiveSummary[]>((resolve, reject) => {
        if (latestRef.current && predicate(latestRef.current)) {
          resolve(latestRef.current)
          return
        }
        const check = (lives: LiveSummary[]) => {
          if (predicate(lives)) {
            cleanup()
            resolve(lives)
          }
        }
        const timer = setTimeout(() => {
          cleanup()
          reject(new Error('Timed out waiting for the live list to update'))
        }, confirmTimeoutMs)
        const cleanup = () => {
          clearTimeout(timer)
          waitersRef.current.delete(check)
        }
        waitersRef.current.add(check)
      }),
    [],
  )

  return {
    lives: data?.myLives ?? [],
    error: error ? errorMessage(error) : '',
    restart,
    waitFor,
  }
}
