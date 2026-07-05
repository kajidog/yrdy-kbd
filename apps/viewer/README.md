# Viewer

React app for joining a KVS WebRTC room with a passphrase and watching the live screen as a `VIEWER`.

## Run

```sh
npm install
npm run dev -- --port 5174
```

Set `VITE_BFF_BASE_URL` if the BFF is not running on `http://localhost:8080`.

## Notes

- The publisher-generated watch link includes `roomId`.
- Each browser tab generates its own KVS viewer `clientId`.
- AWS credentials are never configured in this app.
