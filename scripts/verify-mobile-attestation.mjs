import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createPrivateKey, createPublicKey, verify } from 'node:crypto'
import { pathToFileURL } from 'node:url'

export function verifyEmbeddedAttestation(binary, attestation, { version, platform, variant, publicKey }) {
  if (!attestation) throw new Error('Expected official build attestation is missing')
  const envelope = JSON.parse(Buffer.from(attestation, 'base64url').toString())
  const payload = JSON.parse(Buffer.from(envelope.payload, 'base64url').toString())
  if (payload.schema !== 1 || payload.version !== version || payload.platform !== platform || payload.variant !== variant) {
    throw new Error('Official build metadata does not match this artifact')
  }
  if (!publicKey || !verify(null, Buffer.from(envelope.payload), publicKey, Buffer.from(envelope.signature, 'base64url'))) {
    throw new Error('Official build signature is invalid')
  }
  if (!binary.includes(Buffer.from(attestation))) throw new Error('Official build attestation was NOT embedded in the native binary')
  return payload
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [archive, platform, variant] = process.argv.slice(2)
  if (!archive || !['ipados', 'android'].includes(platform) || !['with-llama', 'remote-only'].includes(variant)) {
    throw new Error('Usage: verify-mobile-attestation.mjs <ipa|apk> <ipados|android> <with-llama|remote-only>')
  }
  const entries = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).split('\n')
  const nativeEntry = platform === 'android' ? 'lib/arm64-v8a/libnstrans_lib.so'
    : entries.find((entry) => /^Payload\/([^/]+)\.app\/\1$/u.test(entry))
  if (!nativeEntry || !entries.includes(nativeEntry)) throw new Error('Native executable missing from mobile archive')
  const binary = execFileSync('unzip', ['-p', archive, nativeEntry], { maxBuffer: 256 * 1024 * 1024 })
  const key = createPublicKey(createPrivateKey({ key: Buffer.from(process.env.CLIENT_BUILD_SIGNING_KEY || '', 'base64'), format: 'der', type: 'pkcs8' }))
  const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version
  const payload = verifyEmbeddedAttestation(binary, process.env.NSTRANS_BUILD_ATTESTATION, { version, platform, variant, publicKey: key })
  console.log(`Verified embedded official proof: ${payload.version} / ${payload.platform} / ${payload.variant}`)
}
