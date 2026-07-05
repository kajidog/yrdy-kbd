# KVS WebRTC Live Screen Sample

Sample app for learning Amazon Kinesis Video Streams WebRTC with a small BFF.

## Apps

- `apps/bff`: Go API server. Owns AWS credentials, creates/reuses KVS signaling channels, returns endpoint/ICE config, and signs KVS WSS URLs.
- `apps/publisher`: React app generated with Vite. Creates a room and broadcasts screen sharing as KVS `MASTER`.
- `apps/viewer`: React app generated with Vite. Joins a room by `roomId` and passphrase as KVS `VIEWER`.

The media stream does not pass through the BFF. The BFF only prepares and signs signaling access.

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
npm run dev -- --port 5173
```

```sh
cd apps/viewer
cp .env.example .env
npm run dev -- --port 5174
```

Open `http://localhost:5173`, create a room, start screen sharing, then open the watch link in another browser tab or device.

## Required AWS Permissions

The BFF's AWS identity needs permissions for the target KVS signaling channels:

- `kinesisvideo:CreateSignalingChannel`
- `kinesisvideo:DescribeSignalingChannel`
- `kinesisvideo:GetSignalingChannelEndpoint`
- `kinesisvideo:GetIceServerConfig`
- `kinesisvideo:ConnectAsMaster`
- `kinesisvideo:ConnectAsViewer`

See [docs/aws-setup.md](docs/aws-setup.md) for the full AWS setup flow.

## Verification

```sh
cd apps/bff && go test ./...
cd apps/publisher && npm run build
cd apps/viewer && npm run build
```
