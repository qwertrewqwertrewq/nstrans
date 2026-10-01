const flash = document.querySelector('#authFlash')
async function submit(form, path) {
  flash.hidden = true
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) { flash.textContent = result.error || '登录失败'; flash.hidden = false; return }
  location.href = result.redirect || '/dashboard'
}
document.querySelector('#clientLoginForm').addEventListener('submit', (event) => { event.preventDefault(); submit(event.currentTarget, '/api/client/login') })
document.querySelector('#clientRegisterForm').addEventListener('submit', (event) => { event.preventDefault(); submit(event.currentTarget, '/api/client/register') })
