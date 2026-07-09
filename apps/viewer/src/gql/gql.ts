/* eslint-disable */
import * as types from './graphql';



/**
 * Map of all GraphQL operations in the project.
 *
 * This map has several performance disadvantages:
 * 1. It is not tree-shakeable, so it will include all operations in the project.
 * 2. It is not minifiable, so the string of a GraphQL query will be multiple times inside the bundle.
 * 3. It does not support dead code elimination, so it will add unused operations.
 *
 * Therefore it is highly recommended to use the babel or swc plugin for production.
 * Learn more about it here: https://the-guild.dev/graphql/codegen/plugins/presets/preset-client#reducing-bundle-size
 */
type Documents = {
    "\n  fragment LiveFields on Live {\n    id\n    title\n    ownerName\n    public\n    record\n    status\n    hasPassphrase\n    hasRecording\n    owned\n    createdAt\n    startedAt\n    endedAt\n    durationSeconds\n    watchUrl\n  }\n": typeof types.LiveFieldsFragmentDoc,
    "\n  query SearchLives($query: String) {\n    lives(query: $query) {\n      ...LiveFields\n    }\n  }\n": typeof types.SearchLivesDocument,
    "\n  query GetLive($id: ID!) {\n    live(id: $id) {\n      ...LiveFields\n    }\n  }\n": typeof types.GetLiveDocument,
    "\n  mutation CreateViewerSession($input: ViewerSessionInput!) {\n    createViewerSession(input: $input) {\n      liveId\n      role\n      region\n      channelArn\n      endpoints {\n        wss\n        https\n      }\n      iceServers {\n        urls\n        username\n        credential\n        ttl\n      }\n    }\n  }\n": typeof types.CreateViewerSessionDocument,
    "\n  mutation CreatePlayback($input: PlaybackInput!) {\n    createPlayback(input: $input) {\n      liveId\n      hlsUrl\n      playbackMode\n      startedAt\n      endedAt\n      durationSeconds\n    }\n  }\n": typeof types.CreatePlaybackDocument,
    "\n  mutation SignSignalingUrl($input: SignSignalingUrlInput!) {\n    signSignalingUrl(input: $input) {\n      signedUrl\n    }\n  }\n": typeof types.SignSignalingUrlDocument,
};
const documents: Documents = {
    "\n  fragment LiveFields on Live {\n    id\n    title\n    ownerName\n    public\n    record\n    status\n    hasPassphrase\n    hasRecording\n    owned\n    createdAt\n    startedAt\n    endedAt\n    durationSeconds\n    watchUrl\n  }\n": types.LiveFieldsFragmentDoc,
    "\n  query SearchLives($query: String) {\n    lives(query: $query) {\n      ...LiveFields\n    }\n  }\n": types.SearchLivesDocument,
    "\n  query GetLive($id: ID!) {\n    live(id: $id) {\n      ...LiveFields\n    }\n  }\n": types.GetLiveDocument,
    "\n  mutation CreateViewerSession($input: ViewerSessionInput!) {\n    createViewerSession(input: $input) {\n      liveId\n      role\n      region\n      channelArn\n      endpoints {\n        wss\n        https\n      }\n      iceServers {\n        urls\n        username\n        credential\n        ttl\n      }\n    }\n  }\n": types.CreateViewerSessionDocument,
    "\n  mutation CreatePlayback($input: PlaybackInput!) {\n    createPlayback(input: $input) {\n      liveId\n      hlsUrl\n      playbackMode\n      startedAt\n      endedAt\n      durationSeconds\n    }\n  }\n": types.CreatePlaybackDocument,
    "\n  mutation SignSignalingUrl($input: SignSignalingUrlInput!) {\n    signSignalingUrl(input: $input) {\n      signedUrl\n    }\n  }\n": types.SignSignalingUrlDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment LiveFields on Live {\n    id\n    title\n    ownerName\n    public\n    record\n    status\n    hasPassphrase\n    hasRecording\n    owned\n    createdAt\n    startedAt\n    endedAt\n    durationSeconds\n    watchUrl\n  }\n"): typeof import('./graphql').LiveFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query SearchLives($query: String) {\n    lives(query: $query) {\n      ...LiveFields\n    }\n  }\n"): typeof import('./graphql').SearchLivesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query GetLive($id: ID!) {\n    live(id: $id) {\n      ...LiveFields\n    }\n  }\n"): typeof import('./graphql').GetLiveDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateViewerSession($input: ViewerSessionInput!) {\n    createViewerSession(input: $input) {\n      liveId\n      role\n      region\n      channelArn\n      endpoints {\n        wss\n        https\n      }\n      iceServers {\n        urls\n        username\n        credential\n        ttl\n      }\n    }\n  }\n"): typeof import('./graphql').CreateViewerSessionDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreatePlayback($input: PlaybackInput!) {\n    createPlayback(input: $input) {\n      liveId\n      hlsUrl\n      playbackMode\n      startedAt\n      endedAt\n      durationSeconds\n    }\n  }\n"): typeof import('./graphql').CreatePlaybackDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SignSignalingUrl($input: SignSignalingUrlInput!) {\n    signSignalingUrl(input: $input) {\n      signedUrl\n    }\n  }\n"): typeof import('./graphql').SignSignalingUrlDocument;


export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}
