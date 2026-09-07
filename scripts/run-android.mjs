import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const cli = resolve(root, 'node_modules/@tauri-apps/cli/tauri.js')
const sdk = process.env.ANDROID_HOME ?? resolve(homedir(), 'Library/Android/sdk')
const ndk = process.env.NDK_HOME ?? resolve(sdk, 'ndk/27.0.12077973')
const homebrewJava = '/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home'
const java = process.env.JAVA_HOME ?? homebrewJava
const rustupBin = '/opt/homebrew/opt/rustup/bin'

for (const [name, path] of [['Android SDK', sdk], ['Android NDK', ndk], ['Java 17', java], ['Tauri CLI', cli]]) {
  if (!existsSync(path)) throw new Error(`${name} not found: ${path}`)
}

const path = existsSync(rustupBin)
  ? `${rustupBin}${delimiter}${process.env.PATH ?? ''}`
  : process.env.PATH
const result = spawnSync(process.execPath, [cli, 'android', ...process.argv.slice(2)], {
  cwd: root,
  env: { ...process.env, ANDROID_HOME: sdk, NDK_HOME: ndk, JAVA_HOME: java, PATH: path },
  stdio: 'inherit',
})

if (result.error) throw result.error
process.exit(result.status ?? 1)
