# Publisher

React app for creating a KVS WebRTC room and broadcasting a screen share as the `MASTER`.

## Run

```sh
npm install
npm run dev -- --port 5173
```

Set `VITE_BFF_BASE_URL` if the BFF is not running on `http://localhost:8080`.

## Notes

- Uses `navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })`.
- AWS credentials are never configured in this app.
- KVS signaling WSS URLs are signed by the Go BFF through the SDK `requestSigner` hook.
