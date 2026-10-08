// Parse Wrangler's formatted JSON stream but only expose redacted proxy diagnostics.
let buffer = '', start = -1, depth = 0, quoted = false, escaped = false
for await (const chunk of process.stdin) {
  for (const char of chunk.toString()) {
    if (start < 0) { if (char !== '{') continue; buffer = ''; start = 0 }
    buffer += char
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false }
    else if (char === '"') quoted = true
    else if (char === '{') depth++
    else if (char === '}') depth--
    if (!quoted && depth === 0) {
      try {
        const event = JSON.parse(buffer)
        for (const log of event.logs || []) if (log.message?.[0] === 'model-relay') console.log(JSON.stringify(log.message))
      } catch { /* Ignore non-JSON CLI notices. */ }
      start = -1; buffer = ''
    }
  }
}
