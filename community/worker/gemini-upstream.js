export const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta'
export function upstreamRequest({ model, prompt, image, search }, key) {
  const parts = [{ text: prompt }]
  if (image) {
    const [, mimeType, data] = image.match(/^data:([^;]+);base64,(.+)$/u)
    parts.push({ inlineData: { mimeType, data } })
  }
  return {
    url: `${GEMINI_ENDPOINT}/models/${model}:generateContent`,
    headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
    payload: { contents: [{ role: 'user', parts }],
      generationConfig: { maxOutputTokens: 4096, ...(/^gemini-2\.5-flash/u.test(model) ? {thinkingConfig: { thinkingBudget: 0 }} : {}) },
      ...(search ? { tools: [{ google_search: {} }] } : {}) },
  }
}
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0
export function upstreamOutput(result) {
  const candidate = result.candidates?.[0]
  if (result.error || !candidate || candidate.finishReason !== 'STOP') throw new Error('UPSTREAM_OUTPUT_INCOMPLETE')
  const text = (candidate.content?.parts || []).filter(part => !part.thought && typeof part.text === 'string').map(part => part.text).join('')
  const usage = result.usageMetadata || {}
  const metadata = candidate.groundingMetadata
  const sources = (metadata?.groundingChunks || []).flatMap(chunk => {
    try {
      const url = new URL(chunk.web?.uri)
      return url.protocol === 'https:' ? [{ title: String(chunk.web.title || url.hostname).slice(0, 200), url: url.href }] : []
    } catch { return [] }
  }).slice(0, 20)
  // Search suggestions are supplied by Google and must be displayed. The client
  // isolates the markup in a sandboxed iframe; never add it to our database.
  const renderedContent = typeof metadata?.searchEntryPoint?.renderedContent === 'string'
    ? metadata.searchEntryPoint.renderedContent.slice(0, 100000) : ''
  return { text, input: count(usage.promptTokenCount), output: count(usage.candidatesTokenCount) + count(usage.thoughtsTokenCount),
    cached: count(usage.cachedContentTokenCount), upstream: typeof result.responseId === 'string' ? result.responseId.slice(0, 200) : null,
    grounding: metadata ? { sources, renderedContent } : undefined }
}
