import { chromium } from 'playwright-core'
import { existsSync } from 'node:fs'

const origin = process.env.NSTRANS_PREVIEW_URL || 'http://127.0.0.1:4173'
const executablePath = process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find(existsSync)
if (!executablePath) throw new Error('未找到 Chrome/Chromium；可通过 CHROME_PATH 指定浏览器路径')
const viewports = [
  { name: '16:9-fhd', width: 1920, height: 1080 },
  { name: '16:10-laptop', width: 1440, height: 900 },
  { name: '4:3', width: 1024, height: 768 },
  { name: 'phone-19.5:9-landscape', width: 844, height: 390 },
  { name: 'phone-19.5:9-portrait', width: 390, height: 844 },
  { name: 'phone-20:9-portrait', width: 412, height: 915 },
]
const modules = ['设置向导', '实时结果与专业名词', '运行日志', '电视字幕输出', 'OCR 识别', '翻译与词库', '名词搜索', '密钥管理', '画面替换']
const themes = ['dark', 'light']

const browser = await chromium.launch({ executablePath, headless: true })
const failures = []
try {
  for (const viewport of viewports) {
    const page = await browser.newPage({ viewport })
    await page.goto(origin, { waitUntil: 'networkidle' })
    for (const theme of themes) {
      await page.evaluate((nextTheme) => localStorage.setItem('nstrans.ui-theme.v1', nextTheme), theme)
      await page.reload({ waitUntil: 'networkidle' })
      for (const moduleName of modules) {
        await page.getByRole('button', { name: moduleName, exact: true }).click()
        await page.waitForTimeout(30)
        const metrics = await page.evaluate(() => {
        const html = document.documentElement
        const body = document.body
        const root = document.querySelector('#root')
        const app = document.querySelector('.app-shell')
        const workspace = document.querySelector('.workspace')
        const rect = app?.getBoundingClientRect()
        return {
          windowScrollX: window.scrollX,
          windowScrollY: window.scrollY,
          htmlOverflowX: html.scrollWidth - html.clientWidth,
          htmlOverflowY: html.scrollHeight - html.clientHeight,
          bodyOverflowX: body.scrollWidth - body.clientWidth,
          bodyOverflowY: body.scrollHeight - body.clientHeight,
          rootOverflowX: root ? root.scrollWidth - root.clientWidth : 999,
          rootOverflowY: root ? root.scrollHeight - root.clientHeight : 999,
          appTop: rect?.top ?? 999,
          appBottomGap: rect ? window.innerHeight - rect.bottom : 999,
          workspaceOverflowX: workspace ? workspace.scrollWidth - workspace.clientWidth : 999,
          workspaceOverflowY: workspace ? workspace.scrollHeight - workspace.clientHeight : 999,
        }
        })
        const invalid = metrics.windowScrollX !== 0
          || metrics.windowScrollY !== 0
          || metrics.htmlOverflowX > 1
          || metrics.htmlOverflowY > 1
          || metrics.bodyOverflowX > 1
          || metrics.bodyOverflowY > 1
          || metrics.rootOverflowX > 1
          || metrics.rootOverflowY > 1
          || Math.abs(metrics.appTop) > 1
          || Math.abs(metrics.appBottomGap) > 1
          || metrics.workspaceOverflowX > 1
          || metrics.workspaceOverflowY > 1
        if (invalid) failures.push({ viewport: viewport.name, theme, module: moduleName, metrics })
      }
    }
    await page.close()
    console.log(`PASS ${viewport.name} ${viewport.width}x${viewport.height} · ${themes.length} themes × ${modules.length} modules`)
  }
} finally {
  await browser.close()
}

if (failures.length) {
  console.error(JSON.stringify(failures, null, 2))
  process.exit(1)
}
console.log(`Fixed-layout verification passed: ${viewports.length} viewports × ${themes.length} themes × ${modules.length} modules`)
