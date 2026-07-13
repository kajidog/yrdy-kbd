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
    "\n  mutation CreateLive($input: CreateLiveInput!) {\n    createLive(input: $input) {\n      ...LiveFields\n    }\n  }\n": typeof types.CreateLiveDocument,
    "\n  query MyLives {\n    myLives {\n      ...LiveFields\n    }\n  }\n": typeof types.MyLivesDocument,
    "\n  mutation CreatePublisherSession($liveId: ID!) {\n    createPublisherSession(liveId: $liveId) {\n      liveId\n      role\n      region\n      channelArn\n      endpoints {\n        wss\n        https\n      }\n      iceServers {\n        urls\n        username\n        credential\n        ttl\n      }\n    }\n  }\n": typeof types.CreatePublisherSessionDocument,
    "\n  mutation JoinStorageSession($liveId: ID!) {\n    joinStorageSession(liveId: $liveId)\n  }\n": typeof types.JoinStorageSessionDocument,
    "\n  mutation StopLive($liveId: ID!) {\n    stopLive(liveId: $liveId) {\n      ...LiveFields\n    }\n  }\n": typeof types.StopLiveDocument,
    "\n  mutation SignSignalingUrl($input: SignSignalingUrlInput!) {\n    signSignalingUrl(input: $input) {\n      signedUrl\n    }\n  }\n": typeof types.SignSignalingUrlDocument,
};
const documents: Documents = {
    "\n  fragment LiveFields on Live {\n    id\n    title\n    ownerName\n    public\n    record\n    status\n    hasPassphrase\n    hasRecording\n    owned\n    createdAt\n    startedAt\n    endedAt\n    durationSeconds\n    watchUrl\n  }\n": types.LiveFieldsFragmentDoc,
    "\n  mutation CreateLive($input: CreateLiveInput!) {\n    createLive(input: $input) {\n      ...LiveFields\n    }\n  }\n": types.CreateLiveDocument,
    "\n  query MyLives {\n    myLives {\n      ...LiveFields\n    }\n  }\n": types.MyLivesDocument,
    "\n  mutation CreatePublisherSession($liveId: ID!) {\n    createPublisherSession(liveId: $liveId) {\n      liveId\n      role\n      region\n      channelArn\n      endpoints {\n        wss\n        https\n      }\n      iceServers {\n        urls\n        username\n        credential\n        ttl\n      }\n    }\n  }\n": types.CreatePublisherSessionDocument,
    "\n  mutation JoinStorageSession($liveId: ID!) {\n    joinStorageSession(liveId: $liveId)\n  }\n": types.JoinStorageSessionDocument,
    "\n  mutation StopLive($liveId: ID!) {\n    stopLive(liveId: $liveId) {\n      ...LiveFields\n    }\n  }\n": types.StopLiveDocument,
    "\n  mutation SignSignalingUrl($input: SignSignalingUrlInput!) {\n    signSignalingUrl(input: $input) {\n      signedUrl\n    }\n  }\n": types.SignSignalingUrlDocument,
};

/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  fragment LiveFields on Live {\n    id\n    title\n    ownerName\n    public\n    record\n    status\n    hasPassphrase\n    hasRecording\n    owned\n    createdAt\n    startedAt\n    endedAt\n    durationSeconds\n    watchUrl\n  }\n"): typeof import('./graphql').LiveFieldsFragmentDoc;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreateLive($input: CreateLiveInput!) {\n    createLive(input: $input) {\n      ...LiveFields\n    }\n  }\n"): typeof import('./graphql').CreateLiveDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  query MyLives {\n    myLives {\n      ...LiveFields\n    }\n  }\n"): typeof import('./graphql').MyLivesDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation CreatePublisherSession($liveId: ID!) {\n    createPublisherSession(liveId: $liveId) {\n      liveId\n      role\n      region\n      channelArn\n      endpoints {\n        wss\n        https\n      }\n      iceServers {\n        urls\n        username\n        credential\n        ttl\n      }\n    }\n  }\n"): typeof import('./graphql').CreatePublisherSessionDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation JoinStorageSession($liveId: ID!) {\n    joinStorageSession(liveId: $liveId)\n  }\n"): typeof import('./graphql').JoinStorageSessionDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation StopLive($liveId: ID!) {\n    stopLive(liveId: $liveId) {\n      ...LiveFields\n    }\n  }\n"): typeof import('./graphql').StopLiveDocument;
/**
 * The graphql function is used to parse GraphQL queries into a document that can be used by GraphQL clients.
 */
export function graphql(source: "\n  mutation SignSignalingUrl($input: SignSignalingUrlInput!) {\n    signSignalingUrl(input: $input) {\n      signedUrl\n    }\n  }\n"): typeof import('./graphql').SignSignalingUrlDocument;


export function graphql(source: string) {
  return (documents as any)[source] ?? {};
}
