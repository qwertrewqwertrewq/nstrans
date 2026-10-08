<script setup lang="ts">
import { onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { auth, loadAuth } from '../services/auth'
import LoadError from '../components/LoadError.vue'
import { rememberReturn } from '../services/navigation'
const route = useRoute()
onMounted(() => rememberReturn(route.query.redirect))
</script>
<template>
  <section class="centered-page">
    <el-card shadow="never">
      <img class="login-logo" src="/project-logo.svg" alt="NSTrans" />
      <h1>登录 NSTrans 社区</h1>
      <p>使用 GitHub 登录，管理词库、参与评分或创建游戏适配。公开词库下载无需登录。</p>
      <LoadError :error="auth.error" @retry="loadAuth(true)" />
      <a v-if="!auth.user" href="/auth/github">
        <el-button type="primary" size="large">使用 GitHub 登录</el-button>
      </a>
      <RouterLink v-else to="/dashboard">
        <el-button type="primary">进入控制面板</el-button>
      </RouterLink>
      <p class="muted">官方客户端也支持用户名与密码注册、登录；登录后可绑定 GitHub。</p>
    </el-card>
  </section>
</template>
