import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const cli = resolve(root, 'node_modules/@tauri-apps/cli/tauri.js')
const rustupBin = '/opt/homebrew/opt/rustup/bin'
const xcodeTools = resolve(root, 'scripts/xcode-tools')
const extraPaths = process.platform === 'darwin'
  ? [xcodeTools, ...(existsSync(rustupBin) ? [rustupBin] : [])]
  : []
const path = [...extraPaths, process.env.PATH ?? ''].join(delimiter)
const bundledXcode = '/Applications/Xcode.app/Contents/Developer'
const developerDir = process.env.DEVELOPER_DIR || (process.platform === 'darwin' && existsSync(bundledXcode) ? bundledXcode : undefined)
const args = process.argv.slice(2)
const isMobileCommand = args[0] === 'ios' || args[0] === 'android'
const desktopConfig = isMobileCommand || process.env.NSTRANS_NO_LLAMA === '1' ? undefined : process.platform === 'darwin' ? 'src-tauri/tauri.macos.full.conf.json' : process.platform === 'win32' ? 'src-tauri/tauri.windows.full.conf.json' : undefined
if (desktopConfig && !args.includes('--config')) args.push('--config', desktopConfig)
const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, env: { ...process.env, PATH: path, ...(developerDir ? { DEVELOPER_DIR: developerDir } : {}) }, stdio: 'inherit' })
if (result.error) throw result.error
process.exit(result.status ?? 1)
