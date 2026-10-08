import { describe, expect, it } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
// @ts-expect-error Build scripts are plain JavaScript, outside the frontend TS project.
import { clientBuildEnvironment } from '../../scripts/client-build-env.mjs'
// @ts-expect-error Build scripts are plain JavaScript, outside the frontend TS project.
import { verifyEmbeddedAttestation } from '../../scripts/verify-mobile-attestation.mjs'

describe('Official mobile build proof', () => {
  it('survives Tauri mobile environment filtering', () => {
    const env = clientBuildEnvironment({ NSTRANS_BUILD_ATTESTATION: 'signed-proof', CLIENT_BUILD_SIGNING_KEY: 'private-key' })
    const forwarded = Object.fromEntries(Object.entries(env).filter(([key]) => /^(TAURI|WRY|CARGO_|RUST_)/u.test(key)))
    expect(forwarded).toEqual({ TAURI_NSTRANS_BUILD_ATTESTATION: 'signed-proof' })
  })
  it('does not retain an old proof for unsigned builds or another variant', () => {
    expect(clientBuildEnvironment({})).toEqual({})
    expect(clientBuildEnvironment({ NSTRANS_BUILD_ATTESTATION: '', TAURI_NSTRANS_BUILD_ATTESTATION: 'old' }).TAURI_NSTRANS_BUILD_ATTESTATION).toBe('')
    expect(clientBuildEnvironment({ NSTRANS_BUILD_ATTESTATION: 'remote', TAURI_NSTRANS_BUILD_ATTESTATION: 'with' }).TAURI_NSTRANS_BUILD_ATTESTATION).toBe('remote')
  })
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const metadata = { schema: 1, version: '1.0.2', platform: 'ipados', variant: 'remote-only' }
  const payload = Buffer.from(JSON.stringify(metadata)).toString('base64url')
  const proof = Buffer.from(JSON.stringify({ payload, signature: sign(null, Buffer.from(payload), privateKey).toString('base64url') })).toString('base64url')
  const expected = { ...metadata, publicKey }
  it('verifies a signed proof in the native executable, independently of Apple signing', () => {
    expect(verifyEmbeddedAttestation(Buffer.from(`native-code${proof}more-code`), proof, expected)).toEqual(metadata)
  })
  it('rejects missing embedded proofs, wrong variants and invalid signatures', () => {
    expect(() => verifyEmbeddedAttestation(Buffer.from('unsigned'), proof, expected)).toThrow('NOT embedded')
    expect(() => verifyEmbeddedAttestation(Buffer.from(proof), proof, { ...expected, variant: 'with-llama' })).toThrow('metadata')
    expect(() => verifyEmbeddedAttestation(Buffer.from(proof), proof, { ...expected, publicKey: generateKeyPairSync('ed25519').publicKey })).toThrow('signature')
  })
})
