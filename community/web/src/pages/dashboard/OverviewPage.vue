<script setup lang="ts">
import { onMounted, ref } from 'vue'
import PageHeader from '../../components/PageHeader.vue'
import LoadError from '../../components/LoadError.vue'
import { api, errorText } from '../../services/api'
import { auth } from '../../services/auth'
import type { Stats } from '../../services/types'
const stats = ref<Stats>(),
  loading = ref(false),
  error = ref('')
const metrics = [
  { key: 'games', label: '适配游戏' },
  { key: 'terms', label: '原文词条' },
  { key: 'translations', label: '候选译文' },
  { key: 'contributors', label: '社区贡献者' },
] as const
async function load() {
  loading.value = true
  error.value = ''
  try {
    stats.value = await api<Stats>('/api/stats')
  } catch (e) {
    error.value = errorText(e)
  } finally {
    loading.value = false
  }
}
onMounted(load)
</script>
<template>
  <div class="page-stack">
    <PageHeader
      eyebrow="OVERVIEW"
      :title="`你好，${auth.user?.login || '贡献者'}`"
      description="管理客户端访问凭证、完善游戏词条，让每次学习成为社区下一次的答案。"
    />
    <LoadError :error="error" @retry="load" />
    <div v-loading="loading" class="metrics-grid">
      <el-card v-for="item in metrics" :key="item.key" shadow="never">
        <el-statistic :title="item.label" :value="stats?.[item.key] || 0" />
      </el-card>
    </div>
    <div class="grid-two">
      <el-card shadow="never">
        <h2>完善社区词库</h2>
        <p>
          搜索游戏词条、比较候选译文，使用赞与踩帮助客户端选择可靠答案。网页手动新增或修改词条会获得
          +3 可信度加分。
        </p>
        <RouterLink to="/dashboard/dictionary">
          <el-button type="primary">进入词库与评分 →</el-button>
        </RouterLink>
      </el-card>
      <el-card shadow="never">
        <h2>连接客户端</h2>
        <p>
          官方客户端登录后会自动配置密钥。第三方集成可在密钥页面生成凭证；词库读取无需登录，共享上传由用户主动开启。
        </p>
        <RouterLink to="/dashboard/keys"><el-button>管理密钥与 API →</el-button></RouterLink>
      </el-card>
    </div>
    <el-alert title="只分享词条，不分享完整对话" type="info" :closable="false" show-icon>
      <p>
        社区收集专有名词、单词和短句，不保存截图或完整游戏对话。每条原文最多保留 3
        个候选译文，客户端获取评分最高的版本。
      </p>
    </el-alert>
  </div>
</template>
