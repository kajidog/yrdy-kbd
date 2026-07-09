export function createClientId() {
  const browserCrypto = globalThis.crypto
  if (typeof browserCrypto.randomUUID === 'function') {
    return `viewer-${browserCrypto.randomUUID()}`
  }

  const bytes = new Uint8Array(8)
  browserCrypto.getRandomValues(bytes)
  return `viewer-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}
