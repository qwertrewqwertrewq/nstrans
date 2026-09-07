import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { COMMON_KATAKANA_SEARCH_EXCLUSIONS as irodoriAndGameTerms } from '../community/worker/commonKatakana.js'

const JMDICT_URL = 'https://www.edrdg.org/pub/Nihongo/JMdict_e.gz'
const IRODORI_URL = 'https://www.irodori.jpf.go.jp/en/resources.html'
const pureKatakana = /^[ァ-ヺー]{2,24}$/u
const normalize = (value) => value.normalize('NFKC').replace(/\s+/gu, '').toLowerCase()
const sql = (value) => `'${value.replaceAll("'", "''")}'`

const response = await fetch(JMDICT_URL)
if (!response.ok || !response.body) throw new Error(`JMdict download failed: ${response.status}`)
const xml = await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).text()
const terms = new Map(irodoriAndGameTerms.map((term) => [normalize(term), { term, source: 'Japan Foundation IRODORI + game UI', url: IRODORI_URL }]))

for (const match of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gu)) {
  const entry = match[1]
  for (const reading of entry.matchAll(/<r_ele>([\s\S]*?)<\/r_ele>/gu)) {
    if (!/<re_pri>gai1<\/re_pri>/u.test(reading[1])) continue
    const term = reading[1].match(/<reb>([^<]+)<\/reb>/u)?.[1]?.trim() ?? ''
    if (pureKatakana.test(term)) terms.set(normalize(term), { term, source: 'JMdict gai1', url: JMDICT_URL })
  }
}

const values = [...terms.entries()].sort(([a], [b]) => a.localeCompare(b, 'ja')).map(([normalized, item]) => `('general',${sql(item.term)},${sql(normalized)},${sql(item.source)},${sql(item.url)})`)
const statements = ["DELETE FROM search_exclusions WHERE game_id='general';"]
for (let index = 0; index < values.length; index += 250) statements.push(`INSERT INTO search_exclusions(game_id,source_text,normalized_source,source_name,source_url) VALUES\n${values.slice(index, index + 250).join(',\n')};`)

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'nstrans-katakana-'))
const sqlFile = join(temporaryDirectory, 'common-katakana.sql')
try {
  await writeFile(sqlFile, statements.join('\n'))
  const result = spawnSync('npx', ['wrangler', 'd1', 'execute', 'nstrans-community', '--remote', '--config', 'community/wrangler.jsonc', '--file', sqlFile], { cwd: process.cwd(), stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
  console.log(`Synced ${terms.size} general katakana search exclusions.`)
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
