import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker, { hashPassword, verifyPassword } from './index.js'

let derive
beforeEach(() => {
  // Node and Miniflare don't reproduce the production-only cap by themselves.
  // Emulate it while still computing real WebCrypto hashes for round-trip tests.
  derive = vi.fn((parameters, key, bits) => {
    if (parameters.iterations > 100000) throw new Error('Pbkdf2 failed: iteration counts above 100000 are not supported')
    return webcrypto.subtle.deriveBits(parameters, key, bits)
  })
  vi.stubGlobal('crypto', {
    getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
    subtle: {
      digest: webcrypto.subtle.digest.bind(webcrypto.subtle),
      importKey: webcrypto.subtle.importKey.bind(webcrypto.subtle),
      deriveBits: derive,
    },
  })
})
afterEach(() => vi.unstubAllGlobals())

function accountEnv(user = { id: 7, role: 'user', github_bound: true }) {
  const writes = []
  return {
    writes,
    SITE_ORIGIN: 'https://nstrans.221129.xyz',
    DB: { prepare: sql => ({ bind: (...values) => ({
      first: async () => user,
      run: async () => { writes.push({ sql, values }); return { success: true } },
    }) }) },
  }
}
const request = (password, { authenticated = true, origin = 'https://nstrans.221129.xyz' } = {}) => new Request('https://nstrans.221129.xyz/api/account/password', {
  method: 'POST', headers: { 'content-type': 'application/json', origin, ...(authenticated ? { cookie: 'session=isolated-test-fixture' } : {}) },
  body: JSON.stringify({ password }),
})

describe('Worker account password hashing', () => {
  it('saves a GitHub account password with a salted hash inside the production cap', async () => {
    const env = accountEnv(), password = 'fixture-password-not-a-real-secret'
    const response = await worker.fetch(request(password), env)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(env.writes).toHaveLength(1)
    const [hash, salt, iterations, userId] = env.writes[0].values
    expect(userId).toBe(7)
    expect(iterations).toBe(100000)
    expect(hash).not.toBe(password)
    expect(salt.length).toBeGreaterThanOrEqual(16)
    expect(await verifyPassword(password, { password_hash: hash, password_salt: salt, password_iterations: iterations })).toBe(true)
    expect(await verifyPassword('wrong-fixture-password', { password_hash: hash, password_salt: salt, password_iterations: iterations })).toBe(false)
  })
  it('uses independent random salts and persists the exact work factor', async () => {
    const a = await hashPassword('fixture-password'), b = await hashPassword('fixture-password')
    expect(a.salt).not.toBe(b.salt)
    expect(a.hash).not.toBe(b.hash)
    const legacy = await hashPassword('fixture-password', 'known-test-salt', 75000)
    expect(await verifyPassword('fixture-password', { password_hash: legacy.hash, password_salt: legacy.salt, password_iterations: legacy.iterations })).toBe(true)
    expect(derive.mock.calls.at(-1)[0].iterations).toBe(75000)
  })
  it('does not silently reinterpret unsupported historical work factors', async () => {
    await expect(hashPassword('fixture-password', 'known-test-salt', 180000)).rejects.toThrow('above 100000')
  })
  it('rejects short, oversized and non-string input before hashing or writing', async () => {
    const env = accountEnv()
    for (const password of ['short', 'x'.repeat(129), { value: 'fixture-password' }, ['fixture-password'], null]) {
      expect((await worker.fetch(request(password), env)).status).toBe(400)
    }
    expect(derive).not.toHaveBeenCalled()
    expect(env.writes).toEqual([])
  })
  it('keeps authentication and origin checks before password processing', async () => {
    const env = accountEnv()
    expect((await worker.fetch(request('fixture-password', { authenticated: false }), env)).status).toBe(401)
    expect((await worker.fetch(request('fixture-password', { origin: 'https://untrusted.example' }), env)).status).toBe(403)
    expect(derive).not.toHaveBeenCalled()
    expect(env.writes).toEqual([])
  })
})
