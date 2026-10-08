import { createRouter, createWebHistory } from 'vue-router'
import { auth, loadAuth } from './services/auth'
import { consumeReturn, dashboardReturn } from './services/navigation'

export const dashboardRoutes = [
  { path: '/dashboard', title: '概览', name: 'overview' },
  { path: '/dashboard/keys', title: '客户端密钥', name: 'keys' },
  { path: '/dashboard/games', title: '游戏管理', name: 'games' },
  { path: '/dashboard/dictionary', title: '词库与评分', name: 'dictionary' },
  { path: '/dashboard/account', title: '账号与绑定', name: 'account' },
  { path: '/dashboard/updates', title: '版本通知', name: 'updates', admin: true },
  { path: '/dashboard/relay', title: '社区中转模型与额度', name: 'relay', admin: true },
]
const pages = {
  overview: () => import('./pages/dashboard/OverviewPage.vue'),
  keys: () => import('./pages/dashboard/KeysPage.vue'),
  games: () => import('./pages/dashboard/GamesPage.vue'),
  dictionary: () => import('./pages/dashboard/DictionaryPage.vue'),
  account: () => import('./pages/dashboard/AccountPage.vue'),
  updates: () => import('./pages/dashboard/UpdatesPage.vue'),
  relay: () => import('./pages/dashboard/ModelRelayPage.vue'),
}
export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    {
      path: '/',
      component: () => import('./layouts/PublicLayout.vue'),
      children: [
        {
          path: '',
          component: () => import('./pages/HomePage.vue'),
          meta: { title: '游戏翻译词库社区' },
        },
        {
          path: 'how-it-works',
          component: () => import('./pages/HowItWorksPage.vue'),
          meta: { title: '工作方式' },
        },
        {
          path: 'client',
          component: () => import('./pages/ClientPage.vue'),
          meta: { title: '客户端接入' },
        },
        {
          path: 'download',
          component: () => import('./pages/DownloadPage.vue'),
          meta: { title: '客户端下载' },
        },
        {
          path: 'donate',
          component: () => import('./pages/DonatePage.vue'),
          meta: { title: '支持项目' },
        },
        {
          path: 'login',
          component: () => import('./pages/LoginPage.vue'),
          meta: { title: '登录社区' },
        },
        {
          path: 'client-auth-complete',
          component: () => import('./pages/AuthCompletePage.vue'),
          meta: { title: '授权完成' },
        },
        {
          path: ':pathMatch(.*)*',
          component: () => import('./pages/NotFoundPage.vue'),
          meta: { title: '页面不存在' },
        },
      ],
    },
    {
      path: '/dashboard',
      component: () => import('./layouts/DashboardLayout.vue'),
      meta: { requiresAuth: true },
      children: dashboardRoutes.map((item) => ({
        path: item.path.slice('/dashboard'.length).replace(/^\//u, ''),
        name: item.name,
        component: pages[item.name as keyof typeof pages],
        meta: { title: item.title, admin: item.admin },
      })),
    },
  ],
})
router.beforeEach(async (to) => {
  if (to.path === '/dashboard' && to.query.view) {
    const item = dashboardRoutes.find((item) => item.name === to.query.view)
    const query = { ...to.query }
    delete query.view
    return { path: item?.path || '/dashboard', query, replace: true }
  }
  if (to.meta.requiresAuth || to.path === '/login') {
    await loadAuth()
    if (to.meta.requiresAuth && !auth.user && !auth.error)
      return { path: '/login', query: { redirect: to.fullPath } }
    if (to.meta.admin && auth.user && auth.user.role !== 'admin') return '/dashboard'
    if (to.path === '/login' && auth.user) return dashboardReturn(to.query.redirect) || '/dashboard'
    if (to.path === '/dashboard' && auth.user) {
      const destination = consumeReturn()
      if (destination && destination !== to.fullPath) return destination
    }
  }
})
router.afterEach((to) => {
  document.title = `${to.meta.title || '社区'} · NSTrans`
})
