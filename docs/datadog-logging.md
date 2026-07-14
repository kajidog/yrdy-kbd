# Datadog logging

The BFF and both browser apps emit structured logs with Datadog unified service
tags. The three service names are:

- `yrdy-kbd-bff`
- `yrdy-kbd-publisher`
- `yrdy-kbd-viewer`

All logging integrations are optional. The application still runs when no
Datadog credentials are configured.

## BFF logs

The BFF writes one JSON object per line to stdout. Each record includes
`timestamp`, `status`, `message`, `service`, `env`, `version`, and `ddsource`.
HTTP completion logs also include `request_id`, method, path, status code, and
duration. Request bodies, query strings, authorization headers, and tokens are
not logged.

For local Docker collection, create the application environment files (if they
do not already exist), then provide an API key from the Datadog organization
that should receive the logs in the root environment file:

```sh
cp .env.example .env
cp apps/bff/.env.example apps/bff/.env
cp apps/publisher/.env.example apps/publisher/.env
cp apps/viewer/.env.example apps/viewer/.env
```

```dotenv
DD_API_KEY=...
DD_SITE=ap1.datadoghq.com
DD_ENV=local
DD_VERSION=dev
```

Then start the optional Datadog Agent profile together with the app:

```sh
docker compose --profile observability up --build
```

Without the profile, `docker compose up` runs the application normally and BFF
logs remain available through `docker compose logs bff`.

## Browser logs

Create a Datadog **client token** and put it in each browser app's ignored
`.env` file. Never put `DD_API_KEY` in a `VITE_*` variable because Vite embeds
those values in browser JavaScript.

```sh
cp apps/publisher/.env.example apps/publisher/.env
cp apps/viewer/.env.example apps/viewer/.env
```

Set these values in both files:

```dotenv
VITE_DD_CLIENT_TOKEN=...
VITE_DD_SITE=ap1.datadoghq.com
VITE_DD_ENV=local
VITE_DD_VERSION=dev
```

The SDK sends an `application started` event when each app loads and forwards
uncaught browser errors. Caught GraphQL failures are logged with the same
`request_id` sent to the BFF, so frontend and backend records can be correlated.

## Verify with mcp-datadog-logs

After opening the publisher and viewer once and calling the BFF health endpoint,
search for all three services:

```text
service:(yrdy-kbd-bff OR yrdy-kbd-publisher OR yrdy-kbd-viewer) env:local
```

For the `fstsfog-mcp-apps` development checkout that contains this repository
under `tmp/yrdy-kbd`, build and launch the local MCP server from the outer
repository root:

```sh
pnpm --filter @kajidog/mcp-datadog-logs build
DD_SITE=ap1.datadoghq.com \
DD_API_KEY=... \
DD_APP_KEY=... \
npx @modelcontextprotocol/inspector node apps/mcp-datadog-logs/dist/index.js
```

The application key needs the `logs_read_data` scope. Use
`datadog_search_logs` for a quick check or `datadog_run_investigation` with the
query above for the timeline and service/status facets. `DD_SITE`, API key,
client token, and application key must all belong to the same Datadog site and
organization.
