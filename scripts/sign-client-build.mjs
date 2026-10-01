#!/usr/bin/env node
import { createPrivateKey, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'

const args = Object.fromEntries(process.argv.slice(2).reduce((all, value, index, list) => {
  if (value.startsWith('--')) all.push([value.slice(2), list[index + 1]])
  return all
}, []))
const platform = args.platform
const variant = args.variant
if (!['macos', 'windows', 'android', 'ipados'].includes(platform) || !['with-llama', 'remote-only'].includes(variant)) {
  throw new Error('Usage: sign-client-build.mjs --platform <macos|windows|android|ipados> --variant <with-llama|remote-only>')
}
const privateDer = process.env.CLIENT_BUILD_SIGNING_KEY
if (!privateDer) throw new Error('CLIENT_BUILD_SIGNING_KEY is required for an official build')
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const issuedAt = new Date()
const days = Number(process.env.CLIENT_BUILD_ATTESTATION_DAYS || 365)
if (!Number.isInteger(days) || days < 1 || days > 730) throw new Error('CLIENT_BUILD_ATTESTATION_DAYS must be between 1 and 730')
const payload = { schema: 1, keyId: process.env.CLIENT_BUILD_KEY_ID || 'nstrans-release-2026-01', version: packageJson.version, platform, variant, issuedAt: issuedAt.toISOString(), expiresAt: new Date(issuedAt.getTime() + days * 86400000).toISOString() }
const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
const key = createPrivateKey({ key: Buffer.from(privateDer, 'base64'), format: 'der', type: 'pkcs8' })
const signature = sign(null, Buffer.from(encodedPayload), key).toString('base64url')
process.stdout.write(Buffer.from(JSON.stringify({ payload: encodedPayload, signature })).toString('base64url'))
