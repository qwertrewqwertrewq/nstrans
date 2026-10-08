<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Menu, ArrowRight } from '@element-plus/icons-vue'
import { auth, loadAuth } from '../services/auth'
import SiteFooter from '../components/SiteFooter.vue'
const open = ref(false),
  route = useRoute()
const links = [
  { to: '/how-it-works', title: '工作方式' },
  { to: '/client', title: '客户端接入' },
  { to: '/download', title: '下载' },
]
onMounted(() => {
  void loadAuth()
})
watch(
  () => route.fullPath,
  () => {
    open.value = false
  },
)
</script>
<template>
  <div class="public-layout">
    <header class="public-header">
      <RouterLink class="brand" to="/">
        <img src="/project-logo.svg" alt="" />
        <span>
          NSTrans
          <small>游戏翻译词库社区</small>
        </span>
      </RouterLink>
      <nav class="public-nav" aria-label="主导航">
        <RouterLink v-for="link in links" :key="link.to" :to="link.to">{{ link.title }}</RouterLink>
        <a
          href="https://github.com/qwertrewqwertrewq/nstrans"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub ↗
        </a>
      </nav>
      <div class="header-actions">
        <RouterLink to="/dashboard">
          <el-button type="primary">
            {{ auth.user ? '进入控制面板' : '控制面板' }}
            <el-icon><ArrowRight /></el-icon>
          </el-button>
        </RouterLink>
        <el-button
          class="mobile-menu-button"
          :icon="Menu"
          circle
          aria-label="打开导航"
          @click="open = true"
        />
      </div>
    </header>
    <main class="public-content"><RouterView /></main>
    <SiteFooter />
    <el-drawer v-model="open" title="导航" size="280px">
      <nav class="mobile-nav">
        <RouterLink to="/">首页</RouterLink>
        <RouterLink v-for="link in links" :key="link.to" :to="link.to">{{ link.title }}</RouterLink>
        <RouterLink to="/donate">支持项目</RouterLink>
        <a
          href="https://github.com/qwertrewqwertrewq/nstrans"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub ↗
        </a>
      </nav>
    </el-drawer>
  </div>
</template>
