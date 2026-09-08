import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

if (process.platform !== 'darwin') throw new Error('DMG 只能在 macOS 上构建')

const root = resolve(import.meta.dirname, '..')
const config = JSON.parse(readFileSync(resolve(root, 'src-tauri/tauri.conf.json'), 'utf8'))
const app = resolve(root, 'src-tauri/target/release/bundle/macos/NSTrans.app')
const architecture = process.arch === 'arm64' ? 'aarch64' : process.arch
const flavor = process.argv.includes('--remote-only') ? '_remote-only' : ''
const dmg = resolve(root, `src-tauri/target/release/bundle/dmg/NSTrans_${config.version}_${architecture}${flavor}.dmg`)

if (!existsSync(app)) throw new Error(`找不到 macOS 应用：${app}`)
mkdirSync(dirname(dmg), { recursive: true })

try {
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' })
} catch {
  // Local Alpha builds have no Developer ID yet. Apply an ad-hoc signature so
  // nested Swift helpers and resources are sealed consistently for local use.
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' })
}

if (existsSync(dmg)) unlinkSync(dmg)
execFileSync('hdiutil', ['create', '-volname', 'NSTrans', '-srcfolder', app, '-format', 'UDZO', dmg], { stdio: 'inherit' })
console.log(`macOS Alpha: ${app}`)
console.log(`macOS DMG:   ${dmg}`)
