#!/usr/bin/env node
import { generateKeyPairSync } from 'node:crypto'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const privateDer = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64')
const publicDer = publicKey.export({ format: 'der', type: 'spki' })
const publicRaw = publicDer.subarray(publicDer.length - 32).toString('base64url')
process.stdout.write(JSON.stringify({
  githubSecret: { CLIENT_BUILD_SIGNING_KEY: privateDer },
  workerSecret: { CLIENT_BUILD_PUBLIC_KEYS: JSON.stringify({ 'nstrans-release-2026-01': publicRaw }) },
}, null, 2) + '\n')
