<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  Menu,
  House,
  Key,
  Collection,
  Reading,
  User,
  Bell,
  Connection,
} from '@element-plus/icons-vue'
import { dashboardRoutes } from '../router'
import { auth, loadAuth } from '../services/auth'
import SiteFooter from '../components/SiteFooter.vue'
import LoadError from '../components/LoadError.vue'
const route = useRoute(),
  open = ref(false)
const items = computed(() =>
  dashboardRoutes.filter((item) => !item.admin || auth.user?.role === 'admin'),
)
const icons = [House, Key, Collection, Reading, User, Bell, Connection]
watch(
  () => route.fullPath,
  () => {
    open.value = false
  },
)
</script>
<template>
  <div class="dashboard-layout">
    <aside class="dashboard-sidebar">
      <RouterLink class="brand" to="/">
        <img src="/project-logo.svg" alt="" />
        <span>
          NSTrans
          <small>社区控制台</small>
        </span>
      </RouterLink>
      <el-menu :default-active="route.path" router>
        <el-menu-item v-for="(item, index) in items" :key="item.path" :index="item.path">
          <el-icon><component :is="icons[index]" /></el-icon>
          <span>{{ item.title }}</span>
        </el-menu-item>
      </el-menu>
      <div class="sidebar-links">
        <RouterLink to="/download">客户端下载 ↗</RouterLink>
        <RouterLink to="/client">接入文档 ↗</RouterLink>
        <RouterLink to="/">返回首页 ↗</RouterLink>
      </div>
    </aside>
    <div class="dashboard-main">
      <header class="dashboard-header">
        <el-button
          class="mobile-menu-button"
          :icon="Menu"
          circle
          aria-label="打开控制台导航"
          @click="open = true"
        />
        <el-breadcrumb>
          <el-breadcrumb-item :to="'/dashboard'">控制面板</el-breadcrumb-item>
          <el-breadcrumb-item>{{ route.meta.title }}</el-breadcrumb-item>
        </el-breadcrumb>
        <div v-if="auth.user" class="account-summary">
          <el-avatar :size="32" :src="auth.user.avatar_url || '/project-logo.svg'" />
          <span>{{ auth.user.login }}</span>
          <el-tag size="small" :type="auth.user.role === 'admin' ? 'success' : 'info'">
            {{ auth.user.role === 'admin' ? '管理员' : '贡献者' }}
          </el-tag>
          <a href="/auth/logout">退出</a>
        </div>
      </header>
      <main class="dashboard-content">
        <LoadError :error="auth.error" @retry="loadAuth(true)" />
        <RouterView v-if="auth.user && !auth.error" />
        <el-empty v-else-if="!auth.loading && !auth.error" description="登录已过期，请重新登录">
          <RouterLink to="/login"><el-button type="primary">重新登录</el-button></RouterLink>
        </el-empty>
        <el-skeleton v-else-if="auth.loading" :rows="6" animated />
      </main>
      <SiteFooter />
    </div>
    <el-drawer v-model="open" title="控制台导航" direction="ltr" size="260px">
      <el-menu :default-active="route.path" router>
        <el-menu-item v-for="item in items" :key="item.path" :index="item.path">
          {{ item.title }}
        </el-menu-item>
      </el-menu>
      <nav class="mobile-nav">
        <RouterLink to="/download">客户端下载</RouterLink>
        <RouterLink to="/">返回首页</RouterLink>
        <RouterLink to="/donate">支持项目</RouterLink>
      </nav>
    </el-drawer>
  </div>
</template>
