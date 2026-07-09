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

export type SearchLivesQueryVariables = Exact<{
  query?: InputMaybe<Scalars['String']['input']>;
}>;


export type SearchLivesQuery = { __typename?: 'Query', lives: Array<{ __typename?: 'Live', id: string, title: string, ownerName: string, public: boolean, record: boolean, status: LiveStatus, hasPassphrase: boolean, hasRecording: boolean, owned: boolean, createdAt: string, startedAt?: string | null, endedAt?: string | null, durationSeconds: number, watchUrl: string }> };

export type GetLiveQueryVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type GetLiveQuery = { __typename?: 'Query', live: { __typename?: 'Live', id: string, title: string, ownerName: string, public: boolean, record: boolean, status: LiveStatus, hasPassphrase: boolean, hasRecording: boolean, owned: boolean, createdAt: string, startedAt?: string | null, endedAt?: string | null, durationSeconds: number, watchUrl: string } };

export type CreateViewerSessionMutationVariables = Exact<{
  input: ViewerSessionInput;
}>;


export type CreateViewerSessionMutation = { __typename?: 'Mutation', createViewerSession: { __typename?: 'SessionConfig', liveId: string, role: Role, region: string, channelArn: string, endpoints: { __typename?: 'EndpointSet', wss: string, https: string }, iceServers: Array<{ __typename?: 'IceServer', urls: Array<string>, username?: string | null, credential?: string | null, ttl?: number | null }> } };

export type CreatePlaybackMutationVariables = Exact<{
  input: PlaybackInput;
}>;


export type CreatePlaybackMutation = { __typename?: 'Mutation', createPlayback: { __typename?: 'Playback', liveId: string, hlsUrl: string, playbackMode: PlaybackMode, startedAt?: string | null, endedAt?: string | null, durationSeconds: number } };

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
export const SearchLivesDocument = new TypedDocumentString(`
    query SearchLives($query: String) {
  lives(query: $query) {
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
}`) as unknown as TypedDocumentString<SearchLivesQuery, SearchLivesQueryVariables>;
export const GetLiveDocument = new TypedDocumentString(`
    query GetLive($id: ID!) {
  live(id: $id) {
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
}`) as unknown as TypedDocumentString<GetLiveQuery, GetLiveQueryVariables>;
export const CreateViewerSessionDocument = new TypedDocumentString(`
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
    `) as unknown as TypedDocumentString<CreateViewerSessionMutation, CreateViewerSessionMutationVariables>;
export const CreatePlaybackDocument = new TypedDocumentString(`
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
    `) as unknown as TypedDocumentString<CreatePlaybackMutation, CreatePlaybackMutationVariables>;
export const SignSignalingUrlDocument = new TypedDocumentString(`
    mutation SignSignalingUrl($input: SignSignalingUrlInput!) {
  signSignalingUrl(input: $input) {
    signedUrl
  }
}
    `) as unknown as TypedDocumentString<SignSignalingUrlMutation, SignSignalingUrlMutationVariables>;