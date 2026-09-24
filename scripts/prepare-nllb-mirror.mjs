#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { spawn } from 'node:child_process'

const MODEL_ID = 'Xenova/nllb-200-distilled-600M'
const REVISION = '261c31d1a5732c67cdd16d80e8d6088507c7ccea'
const PACKAGE_NAME = 'nstrans-nllb-200-distilled-600M-q8-v1'
const FILES = [
  'README.md',
  'config.json',
  'generation_config.json',
  'quantize_config.json',
  'sentencepiece.bpe.model',
  'special_tokens_map.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
]

const projectDir = resolve(import.meta.dirname, '..')
const outputDir = join(projectDir, '.build', 'models')
const stagingDir = join(outputDir, PACKAGE_NAME)
const archivePath = join(outputDir, `${PACKAGE_NAME}.zip`)

async function sha256(path) {
  const digest = createHash('sha256')
  const handle = await import('node:fs').then(({ createReadStream }) => createReadStream(path))
  for await (const chunk of handle) digest.update(chunk)
  return digest.digest('hex')
}

async function download(relativePath) {
  const target = join(stagingDir, relativePath)
  await mkdir(dirname(target), { recursive: true })
  const url = `https://huggingface.co/${MODEL_ID}/resolve/${REVISION}/${relativePath}`
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`下载失败 ${response.status}: ${url}`)

  const expected = Number(response.headers.get('content-length') ?? 0)
  let received = 0
  let lastReportAt = 0
  const progress = new TransformStream({
    transform(chunk, controller) {
      received += chunk.byteLength
      if (expected > 0 && Date.now() - lastReportAt > 1000) {
        process.stdout.write(`\r${relativePath}: ${(received / expected * 100).toFixed(1)}%`)
        lastReportAt = Date.now()
      }
      controller.enqueue(chunk)
    },
  })
  await pipeline(Readable.fromWeb(response.body.pipeThrough(progress)), createWriteStream(target))
  process.stdout.write(`\r${relativePath}: ${(received / 1024 / 1024).toFixed(1)} MiB\n`)
  if (expected > 0 && received !== expected) throw new Error(`${relativePath} 文件大小不完整：${received}/${expected}`)
}

async function run(command, args, cwd) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolvePromise() : reject(new Error(`${command} 退出码 ${code}`)))
  })
}

await mkdir(outputDir, { recursive: true })
await rm(stagingDir, { recursive: true, force: true })
await rm(archivePath, { force: true })
await mkdir(stagingDir, { recursive: true })

for (const file of FILES) await download(file)

const entries = []
for (const file of FILES) {
  const path = join(stagingDir, file)
  entries.push({ path: file, size: (await stat(path)).size, sha256: await sha256(path) })
}

const manifest = {
  schemaVersion: 1,
  package: PACKAGE_NAME,
  modelId: MODEL_ID,
  revision: REVISION,
  dtype: 'q8',
  runtime: '@huggingface/transformers + ONNX Runtime Web',
  license: 'CC-BY-NC-4.0',
  files: entries,
}
await writeFile(join(stagingDir, 'nstrans-model-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
await writeFile(join(stagingDir, 'NOTICE.txt'), [
  'NSTrans NLLB mirror package',
  `Source: https://huggingface.co/${MODEL_ID}`,
  `Pinned revision: ${REVISION}`,
  'Model license: CC BY-NC 4.0',
  'This package contains only the Q8 ONNX files used by NSTrans.',
  '',
].join('\n'))

// Store ONNX bytes without recompression. They are already densely encoded and
// deflating them would make release preparation much slower for little benefit.
await run('zip', ['-0', '-q', '-r', archivePath, basename(stagingDir)], outputDir)
const archiveSize = (await stat(archivePath)).size
const archiveSha = await sha256(archivePath)
await writeFile(`${archivePath}.sha256`, `${archiveSha}  ${basename(archivePath)}\n`)

const parsedManifest = JSON.parse(await readFile(join(stagingDir, 'nstrans-model-manifest.json'), 'utf8'))
console.log(JSON.stringify({
  archivePath,
  archiveSize,
  archiveSha256: archiveSha,
  revision: parsedManifest.revision,
  files: parsedManifest.files.length,
}, null, 2))
