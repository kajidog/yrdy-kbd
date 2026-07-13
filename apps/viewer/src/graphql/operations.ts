// GraphQL operations for the viewer app. `graphql()` comes from codegen
// (src/gql) and types every document automatically — run `npm run codegen`
// after editing an operation.

import { executeGraphQL } from '@yrdy-kbd/web-shared'
import { graphql } from '../gql'
import type { LiveFieldsFragment, SignSignalingUrlInput } from '../gql/graphql'

export type LiveSummary = LiveFieldsFragment

graphql(`
  fragment LiveFields on Live {
    id
    title
    ownerName
    public
    record
    status
    hasPassphrase
    hasRecording
    owned
    createdAt
    startedAt
    endedAt
    durationSeconds
    watchUrl
  }
`)

const SearchLives = graphql(`
  query SearchLives($query: String) {
    lives(query: $query) {
      ...LiveFields
    }
  }
`)

export async function searchLives(query: string): Promise<LiveSummary[]> {
  const data = await executeGraphQL(SearchLives, { query: query.trim() || null })
  return data.lives
}

const GetLive = graphql(`
  query GetLive($id: ID!) {
    live(id: $id) {
      ...LiveFields
    }
  }
`)

export async function getLive(liveId: string): Promise<LiveSummary> {
  const data = await executeGraphQL(GetLive, { id: liveId })
  return data.live
}

const CreateViewerSession = graphql(`
  mutation CreateViewerSession($input: ViewerSessionInput!) {
    createViewerSession(input: $input) {
      liveId
      role
      region
      channelArn
      endpoints {
        wss
        https
      }
      iceServers {
        urls
        username
        credential
        ttl
      }
    }
  }
`)

export type ViewerSession = Awaited<ReturnType<typeof createViewerSession>>

export async function createViewerSession(input: {
  liveId: string
  clientId: string
  passphrase?: string
}) {
  const data = await executeGraphQL(CreateViewerSession, {
    input: {
      liveId: input.liveId,
      clientId: input.clientId,
      passphrase: input.passphrase || null,
    },
  })
  return data.createViewerSession
}

const CreatePlayback = graphql(`
  mutation CreatePlayback($input: PlaybackInput!) {
    createPlayback(input: $input) {
      liveId
      hlsUrl
      playbackMode
      startedAt
      endedAt
      durationSeconds
    }
  }
`)

export type PlaybackInfo = Awaited<ReturnType<typeof getPlayback>>

export async function getPlayback(input: { liveId: string; passphrase?: string }) {
  const data = await executeGraphQL(CreatePlayback, {
    input: {
      liveId: input.liveId,
      passphrase: input.passphrase || null,
    },
  })
  return data.createPlayback
}

const SignSignalingUrl = graphql(`
  mutation SignSignalingUrl($input: SignSignalingUrlInput!) {
    signSignalingUrl(input: $input) {
      signedUrl
    }
  }
`)

export async function signSignalingUrl(input: SignSignalingUrlInput): Promise<string> {
  const data = await executeGraphQL(SignSignalingUrl, { input })
  return data.signSignalingUrl.signedUrl
}
