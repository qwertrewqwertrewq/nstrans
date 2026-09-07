import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const tauri = resolve(root, 'node_modules/.bin/tauri')
const rustupBin = '/opt/homebrew/opt/rustup/bin'
const xcodeTools = resolve(root, 'scripts/xcode-tools')
const extraPaths = process.platform === 'darwin'
  ? [xcodeTools, ...(existsSync(rustupBin) ? [rustupBin] : [])]
  : []
const path = [...extraPaths, process.env.PATH ?? ''].join(delimiter)
const bundledXcode = '/Applications/Xcode.app/Contents/Developer'
const developerDir = process.env.DEVELOPER_DIR || (process.platform === 'darwin' && existsSync(bundledXcode) ? bundledXcode : undefined)
const result = spawnSync(tauri, process.argv.slice(2), { cwd: root, env: { ...process.env, PATH: path, ...(developerDir ? { DEVELOPER_DIR: developerDir } : {}) }, stdio: 'inherit' })
if (result.error) throw result.error
process.exit(result.status ?? 1)
