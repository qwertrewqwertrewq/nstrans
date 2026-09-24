// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { parseMachineTranslationPage } from './webMachineTranslation'

describe('parseMachineTranslationPage', () => {
  it('extracts Youdao mobile page results', () => {
    expect(parseMachineTranslationPage('youdao-web', '<ul id="translateResult"><li>塞尔达</li><li>传说</li></ul>')).toBe('塞尔达\n传说')
  })

  it('extracts Google mobile page results', () => {
    expect(parseMachineTranslationPage('google-web', '<div class="result-container">海拉鲁平原</div>')).toBe('海拉鲁平原')
  })

  it.each(['bing-web', 'deepl-web'] as const)('extracts normalized %s responses', (provider) => {
    expect(parseMachineTranslationPage(provider, JSON.stringify({ translation: '塞尔达传说' }))).toBe('塞尔达传说')
  })

  it('extracts normalized Google responses', () => {
    expect(parseMachineTranslationPage('google-web', JSON.stringify({ translation: '今天探索海拉鲁平原。' }))).toBe('今天探索海拉鲁平原。')
  })

  it('reports verification pages clearly', () => {
    expect(() => parseMachineTranslationPage('google-web', '<title>unusual traffic captcha</title>')).toThrow('服务方验证')
  })
})
