import { existsSync, mkdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

if (process.platform === 'darwin') {
  mkdirSync('native/macos/bin', { recursive: true })
  const targets = [
    { source: 'native/macos/TranslationCLI.swift', output: 'native/macos/bin/nstrans-translate', frameworks: ['Translation'] },
    { source: 'native/macos/VisionOCRCLI.swift', output: 'native/macos/bin/nstrans-vision-ocr', frameworks: ['Vision', 'ImageIO'] },
  ]
  for (const target of targets) {
    const shouldBuild = !existsSync(target.output) || statSync(target.source).mtimeMs > statSync(target.output).mtimeMs
    if (!shouldBuild) continue
    const frameworkArgs = target.frameworks.flatMap((framework) => ['-framework', framework])
    const result = spawnSync('xcrun', ['swiftc', '-parse-as-library', '-O', ...frameworkArgs, target.source, '-o', target.output], { stdio: 'inherit' })
    if (result.status !== 0) process.exit(result.status ?? 1)
  }
}
