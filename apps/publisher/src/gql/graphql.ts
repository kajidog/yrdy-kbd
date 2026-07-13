/* eslint-disable */
import type { DocumentTypeDecoration } from '@graphql-typed-document-node/core';
export type Maybe<T> = T | null;
export type InputMaybe<T> = T | null | undefined;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  /** Flat string-to-string map, e.g. KVS signaling query parameters. */
  StringMap: { input: Record<string, string>; output: Record<string, string>; }
  /** RFC 3339 timestamp, e.g. 2026-07-09T12:34:56Z. */
  Time: { input: string; output: string; }
};

export type CreateLiveInput = {
  passphrase?: InputMaybe<Scalars['String']['input']>;
  public: Scalars['Boolean']['input'];
  record: Scalars['Boolean']['input'];
  title: Scalars['String']['input'];
};

export type EndpointSet = {
  __typename?: 'EndpointSet';
  https: Scalars['String']['output'];
  wss: Scalars['String']['output'];
};

export type IceServer = {
  __typename?: 'IceServer';
  credential?: Maybe<Scalars['String']['output']>;
  ttl?: Maybe<Scalars['Int']['output']>;
  urls: Array<Scalars['String']['output']>;
  username?: Maybe<Scalars['String']['output']>;
};

export type Live = {
  __typename?: 'Live';
  createdAt: Scalars['Time']['output'];
  /** Elapsed broadcast time in seconds; 0 until the broadcast starts. */
  durationSeconds: Scalars['Int']['output'];
  endedAt?: Maybe<Scalars['Time']['output']>;
  hasPassphrase: Scalars['Boolean']['output'];
  /** Whether archived media exists (or is being written) for HLS playback. */
  hasRecording: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  /** Whether the caller owns this live. */
  owned: Scalars['Boolean']['output'];
  ownerName: Scalars['String']['output'];
  public: Scalars['Boolean']['output'];
  record: Scalars['Boolean']['output'];
  startedAt?: Maybe<Scalars['Time']['output']>;
  status: LiveStatus;
  title: Scalars['String']['output'];
  /** Viewer app URL for this live. */
  watchUrl: Scalars['String']['output'];
};

export type LiveStatus =
  | 'CREATED'
  | 'ENDED'
  | 'LIVE';

/** The authenticated caller. */
export type Me = {
  __typename?: 'Me';
  userId: Scalars['ID']['output'];
  username: Scalars['String']['output'];
};

export type Mutation = {
  __typename?: 'Mutation';
  createLive: Live;
  /** Mints an HLS playback URL for a recorded (or still recording) live. */
  createPlayback: Playback;
  /** Starts (or resumes) broadcasting. Owner only; marks the live as LIVE. */
  createPublisherSession: SessionConfig;
  createViewerSession: SessionConfig;
  /** Asks KVS to join the channel as the recording peer. Owner only. */
  joinStorageSession: Scalars['Boolean']['output'];
  /** Signs a KVS signaling WSS URL with the BFF's AWS credentials. */
  signSignalingUrl: SignedUrl;
  /** Marks the live as ended. Owner only. */
  stopLive: Live;
};


export type MutationCreateLiveArgs = {
  input: CreateLiveInput;
};


export type MutationCreatePlaybackArgs = {
  input: PlaybackInput;
};


export type MutationCreatePublisherSessionArgs = {
  liveId: Scalars['ID']['input'];
};


export type MutationCreateViewerSessionArgs = {
  input: ViewerSessionInput;
};


export type MutationJoinStorageSessionArgs = {
  liveId: Scalars['ID']['input'];
};


export type MutationSignSignalingUrlArgs = {
  input: SignSignalingUrlInput;
};


export type MutationStopLiveArgs = {
  liveId: Scalars['ID']['input'];
};

export type Playback = {
  __typename?: 'Playback';
  durationSeconds: Scalars['Int']['output'];
  endedAt?: Maybe<Scalars['Time']['output']>;
  hlsUrl: Scalars['String']['output'];
  liveId: Scalars['ID']['output'];
  playbackMode: PlaybackMode;
  startedAt?: Maybe<Scalars['Time']['output']>;
};

export type PlaybackInput = {
  liveId: Scalars['ID']['input'];
  passphrase?: InputMaybe<Scalars['String']['input']>;
};

export type PlaybackMode =
  | 'LIVE'
  | 'ON_DEMAND';

export type Query = {
  __typename?: 'Query';
  live: Live;
  /** Public lives that are on air or have a recording, filtered by title or owner name. */
  lives: Array<Live>;
  me: Me;
  /** Lives owned by the caller, newest first. */
  myLives: Array<Live>;
};


export type QueryLiveArgs = {
  id: Scalars['ID']['input'];
};


export type QueryLivesArgs = {
  query?: InputMaybe<Scalars['String']['input']>;
};

export type Role =
  | 'MASTER'
  | 'VIEWER';

/** Everything a client needs to open a KVS WebRTC signaling connection. */
export type SessionConfig = {
  __typename?: 'SessionConfig';
  channelArn: Scalars['String']['output'];
  endpoints: EndpointSet;
  iceServers: Array<IceServer>;
  liveId: Scalars['ID']['output'];
  region: Scalars['String']['output'];
  role: Role;
};

export type SignSignalingUrlInput = {
  /** Required for VIEWER, forbidden for MASTER. */
  clientId?: InputMaybe<Scalars['String']['input']>;
  /** KVS WSS endpoint to sign. */
  endpoint: Scalars['String']['input'];
  liveId: Scalars['ID']['input'];
  passphrase?: InputMaybe<Scalars['String']['input']>;
  /** Query parameters produced by the KVS WebRTC SDK. */
  queryParams: Scalars['StringMap']['input'];
  role: Role;
};

export type SignedUrl = {
  __typename?: 'SignedUrl';
  signedUrl: Scalars['String']['output'];
};

export type ViewerSessionInput = {
  clientId: Scalars['String']['input'];
  liveId: Scalars['ID']['input'];
  passphrase?: InputMaybe<Scalars['String']['input']>;
};

export type LiveFieldsFragment = { __typename?: 'Live', id: string, title: string, ownerName: string, public: boolean, record: boolean, status: LiveStatus, hasPassphrase: boolean, hasRecording: boolean, owned: boolean, createdAt: string, startedAt?: string | null, endedAt?: string | null, durationSeconds: number, watchUrl: string };

export type CreateLiveMutationVariables = Exact<{
  input: CreateLiveInput;
}>;


export type CreateLiveMutation = { __typename?: 'Mutation', createLive: { __typename?: 'Live', id: string, title: string, ownerName: string, public: boolean, record: boolean, status: LiveStatus, hasPassphrase: boolean, hasRecording: boolean, owned: boolean, createdAt: string, startedAt?: string | null, endedAt?: string | null, durationSeconds: number, watchUrl: string } };

export type MyLivesQueryVariables = Exact<{ [key: string]: never; }>;


export type MyLivesQuery = { __typename?: 'Query', myLives: Array<{ __typename?: 'Live', id: string, title: string, ownerName: string, public: boolean, record: boolean, status: LiveStatus, hasPassphrase: boolean, hasRecording: boolean, owned: boolean, createdAt: string, startedAt?: string | null, endedAt?: string | null, durationSeconds: number, watchUrl: string }> };

export type CreatePublisherSessionMutationVariables = Exact<{
  liveId: Scalars['ID']['input'];
}>;


export type CreatePublisherSessionMutation = { __typename?: 'Mutation', createPublisherSession: { __typename?: 'SessionConfig', liveId: string, role: Role, region: string, channelArn: string, endpoints: { __typename?: 'EndpointSet', wss: string, https: string }, iceServers: Array<{ __typename?: 'IceServer', urls: Array<string>, username?: string | null, credential?: string | null, ttl?: number | null }> } };

export type JoinStorageSessionMutationVariables = Exact<{
  liveId: Scalars['ID']['input'];
}>;


export type JoinStorageSessionMutation = { __typename?: 'Mutation', joinStorageSession: boolean };

export type StopLiveMutationVariables = Exact<{
  liveId: Scalars['ID']['input'];
}>;


export type StopLiveMutation = { __typename?: 'Mutation', stopLive: { __typename?: 'Live', id: string, title: string, ownerName: string, public: boolean, record: boolean, status: LiveStatus, hasPassphrase: boolean, hasRecording: boolean, owned: boolean, createdAt: string, startedAt?: string | null, endedAt?: string | null, durationSeconds: number, watchUrl: string } };

export type SignSignalingUrlMutationVariables = Exact<{
  input: SignSignalingUrlInput;
}>;


export type SignSignalingUrlMutation = { __typename?: 'Mutation', signSignalingUrl: { __typename?: 'SignedUrl', signedUrl: string } };

export class TypedDocumentString<TResult, TVariables>
  extends String
  implements DocumentTypeDecoration<TResult, TVariables>
{
  __apiType?: NonNullable<DocumentTypeDecoration<TResult, TVariables>['__apiType']>;
  private value: string;
  public __meta__?: Record<string, any> | undefined;

  constructor(value: string, __meta__?: Record<string, any> | undefined) {
    super(value);
    this.value = value;
    this.__meta__ = __meta__;
  }

  override toString(): string & DocumentTypeDecoration<TResult, TVariables> {
    return this.value;
  }
}
export const LiveFieldsFragmentDoc = new TypedDocumentString(`
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
    `, {"fragmentName":"LiveFields"}) as unknown as TypedDocumentString<LiveFieldsFragment, unknown>;
export const CreateLiveDocument = new TypedDocumentString(`
    mutation CreateLive($input: CreateLiveInput!) {
  createLive(input: $input) {
    ...LiveFields
  }
}
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
}`) as unknown as TypedDocumentString<CreateLiveMutation, CreateLiveMutationVariables>;
export const MyLivesDocument = new TypedDocumentString(`
    query MyLives {
  myLives {
    ...LiveFields
  }
}
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
}`) as unknown as TypedDocumentString<MyLivesQuery, MyLivesQueryVariables>;
export const CreatePublisherSessionDocument = new TypedDocumentString(`
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
    `) as unknown as TypedDocumentString<CreatePublisherSessionMutation, CreatePublisherSessionMutationVariables>;
export const JoinStorageSessionDocument = new TypedDocumentString(`
    mutation JoinStorageSession($liveId: ID!) {
  joinStorageSession(liveId: $liveId)
}
    `) as unknown as TypedDocumentString<JoinStorageSessionMutation, JoinStorageSessionMutationVariables>;
export const StopLiveDocument = new TypedDocumentString(`
    mutation StopLive($liveId: ID!) {
  stopLive(liveId: $liveId) {
    ...LiveFields
  }
}
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
}`) as unknown as TypedDocumentString<StopLiveMutation, StopLiveMutationVariables>;
export const SignSignalingUrlDocument = new TypedDocumentString(`
    mutation SignSignalingUrl($input: SignSignalingUrlInput!) {
  signSignalingUrl(input: $input) {
    signedUrl
  }
}
    `) as unknown as TypedDocumentString<SignSignalingUrlMutation, SignSignalingUrlMutationVariables>;