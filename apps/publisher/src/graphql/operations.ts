// GraphQL operations for the publisher app. `graphql()` comes from codegen
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

const CreateLive = graphql(`
  mutation CreateLive($input: CreateLiveInput!) {
    createLive(input: $input) {
      ...LiveFields
    }
  }
`)

export type CreateLiveInput = {
  title: string
  passphrase?: string
  public: boolean
  record: boolean
}

export async function createLive(input: CreateLiveInput): Promise<LiveSummary> {
  const data = await executeGraphQL(CreateLive, {
    input: {
      title: input.title,
      passphrase: input.passphrase || null,
      public: input.public,
      record: input.record,
    },
  })
  return data.createLive
}

const MyLives = graphql(`
  query MyLives {
    myLives {
      ...LiveFields
    }
  }
`)

export async function listMyLives(): Promise<LiveSummary[]> {
  const data = await executeGraphQL(MyLives)
  return data.myLives
}

const CreatePublisherSession = graphql(`
  mutation CreatePublisherSession($liveId: ID!) {
    createPublisherSession(liveId: $liveId) {
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

export type PublisherSession = Awaited<ReturnType<typeof createPublisherSession>>

export async function createPublisherSession(liveId: string) {
  const data = await executeGraphQL(CreatePublisherSession, { liveId })
  return data.createPublisherSession
}

const JoinStorageSession = graphql(`
  mutation JoinStorageSession($liveId: ID!) {
    joinStorageSession(liveId: $liveId)
  }
`)

export async function joinStorageSession(liveId: string): Promise<void> {
  await executeGraphQL(JoinStorageSession, { liveId })
}

const StopLive = graphql(`
  mutation StopLive($liveId: ID!) {
    stopLive(liveId: $liveId) {
      ...LiveFields
    }
  }
`)

export async function stopLive(liveId: string): Promise<LiveSummary> {
  const data = await executeGraphQL(StopLive, { liveId })
  return data.stopLive
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
