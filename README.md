# KVS WebRTC Live Screen Sample

Sample app for learning Amazon Kinesis Video Streams WebRTC with a small BFF.
Users sign in with Cognito, start lives with a title / optional passphrase /
public flag, optionally record them through KVS WebRTC media ingestion, and
watch live streams (WebRTC) or recordings (HLS) from a searchable catalog.

## Apps

- `apps/bff`: Go API server. Owns AWS credentials, manages lives (title,
  visibility, passphrase, owner, recording state; persisted to a JSON file),
  creates/reuses KVS signaling channels and streams, enables media storage,
  joins storage sessions for recording, signs KVS WSS URLs, and issues HLS
  playback URLs.
- `apps/publisher`: React app. Sign in, create a live (title, passphrase,
  public, record), broadcast screen sharing as KVS `MASTER`, and manage your
  own lives.
- `apps/viewer`: React app. Sign in, search lives by title or username, watch
  live broadcasts over WebRTC and past broadcasts over HLS with a custom
  player (tick-marked seek bar, wall-clock time display, buffered ranges,
  playback speed, keyboard shortcuts).

The media stream does not pass through the BFF. The BFF only prepares and
signs signaling access and mints HLS playback URLs.

## Authentication

The frontends sign in against a Cognito user pool (`USER_PASSWORD_AUTH`) and
send the ID token as `Authorization: Bearer <jwt>` to the BFF. The BFF only
decodes the token payload to identify the user — signature and issuer
verification is done in front of the BFF by CloudFront + Lambda@Edge in a real
deployment, so it is intentionally not re-verified here.

For local development you can leave the `VITE_COGNITO_*` env vars empty: the
apps then run in dev mode and mint unsigned tokens for any username.

## Recording

When a live is created with **Record** enabled, the BFF creates a KVS video
stream (`yrdy-kbd-{liveId}`) and links it to the signaling channel with
`UpdateMediaStorageConfiguration`. Once the publisher's master connection is
up, the BFF calls `JoinStorageSession`, KVS joins as a recording peer, and the
broadcast is archived into the stream. Playback uses
`GetHLSStreamingSessionURL` (`LIVE` while broadcasting, `ON_DEMAND` with the
live's start/end timestamps afterwards).

Note: KVS media ingestion requires an audio track, so the publisher adds a
silent Opus track when the captured screen has no audio.

## Run Locally

```sh
cd apps/bff
cp .env.example .env
set -a
source .env
set +a
export AWS_PROFILE=your-profile
go run .
```

```sh
cd apps/publisher
cp .env.example .env
npm install
npm run dev -- --port 5173
```

```sh
cd apps/viewer
cp .env.example .env
npm install
npm run dev -- --port 5174
```

Open `http://localhost:5173`, sign in (any username in dev mode), create a
live, and go live with screen sharing. Open `http://localhost:5174` in another
tab or device, sign in, and find the live via search or the copied watch link.
After stopping a recorded live, it appears under "Past broadcasts" and plays
over HLS.

## Required AWS Permissions

The BFF's AWS identity needs permissions for the target KVS signaling
channels and streams:

- `kinesisvideo:CreateSignalingChannel`
- `kinesisvideo:DescribeSignalingChannel`
- `kinesisvideo:GetSignalingChannelEndpoint`
- `kinesisvideo:GetIceServerConfig`
- `kinesisvideo:ConnectAsMaster`
- `kinesisvideo:ConnectAsViewer`
- `kinesisvideo:UpdateMediaStorageConfiguration`
- `kinesisvideo:JoinStorageSession`
- `kinesisvideo:CreateStream`
- `kinesisvideo:DescribeStream`
- `kinesisvideo:GetDataEndpoint`
- `kinesisvideo:GetHLSStreamingSessionURL`

See [docs/aws-setup.md](docs/aws-setup.md) for the full AWS setup flow,
including the Cognito user pool.

## Verification

```sh
cd apps/bff && go test ./...
cd apps/publisher && npm run build
cd apps/viewer && npm run build
```
