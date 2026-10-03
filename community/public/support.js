// Shared support entry for public pages and the authenticated console.
const footer = document.createElement('footer')
footer.className = 'support-footer'
footer.innerHTML = '<span>NSTrans · 开源游戏翻译</span><a href="/donate">支持项目 / Donate ↗</a>'
const oldFooter = document.querySelector('.simple-footer')
if (oldFooter) oldFooter.append(footer.querySelector('a'))
else (document.querySelector('.console-main') || document.body).append(footer)

if (document.body.dataset.page === 'download') {
  const dialog = document.createElement('dialog')
  dialog.className = 'support-dialog'
  dialog.setAttribute('aria-labelledby', 'support-title')
  dialog.innerHTML = '<div class="dialog-head"><span class="kicker">THANK YOU FOR YOUR SUPPORT</span><button type="button" class="icon-button" aria-label="关闭支持提示">×</button></div><h2 id="support-title">感谢使用 NSTrans</h2><p>如果觉得此项目不错的话，请到GitHub仓库点颗Star！也可捐赠来支持本项目</p><div class="support-actions"><a class="button" href="https://github.com/qwertrewqwertrewq/nstrans" target="_blank" rel="noopener noreferrer">GitHub · Star ↗</a><a class="button secondary" href="/donate" target="_blank" rel="noopener noreferrer">捐赠支持 ↗</a></div><p>下载请求已提交，无需捐赠即可使用。如果没有开始下载，请关闭提示后重试。</p><button type="button" class="support-dismiss">暂时不用，继续下载</button>'
  document.body.append(dialog)
  dialog.querySelectorAll('button').forEach((button) => button.addEventListener('click', () => dialog.close()))
  dialog.addEventListener('click', (event) => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close() } })
  document.querySelectorAll('a[href^="/download/"]').forEach((link) => {
    // Keep the native download navigation and modifiers; show the prompt in this tab.
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.addEventListener('click', () => { if (!dialog.open) dialog.showModal() })
  })
}

document.getElementById('copy-donation-address')?.addEventListener('click', async () => {
  const input = document.getElementById('donation-address')
  const status = document.getElementById('copy-donation-status')
  try { await navigator.clipboard.writeText(input.value); status.textContent = '地址已复制，请再次核对网络和收款地址。' }
  catch { input.focus(); input.select(); status.textContent = '无法自动复制，地址已选中，请手动复制。' }
})

const donationTabs = document.querySelector('.donate-tabs')
if (donationTabs) {
  const tabs = [...donationTabs.querySelectorAll('[role="tab"]')]
  const narrow = window.matchMedia('(max-width: 1099px)')
  let selected = 0
  const syncTabs = () => {
    donationTabs.hidden = !narrow.matches
    tabs.forEach((tab, index) => {
      const panel = document.getElementById(tab.getAttribute('aria-controls'))
      tab.setAttribute('aria-selected', String(selected === index))
      tab.tabIndex = selected === index ? 0 : -1
      panel.hidden = narrow.matches && selected !== index
      if (narrow.matches) { panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', tab.id); panel.tabIndex = 0 }
      else { panel.removeAttribute('role'); panel.removeAttribute('aria-labelledby'); panel.removeAttribute('tabindex') }
    })
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => { selected = index; syncTabs() })
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      selected = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (selected + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
      syncTabs(); tabs[selected].focus()
    })
  })
  narrow.addEventListener('change', syncTabs)
  syncTabs()
}
