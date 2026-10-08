<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../services/api'
import type { Stats } from '../services/types'
const stats = ref<Stats | null>(null)
const metrics = [
  { key: 'games', label: '已收录游戏' },
  { key: 'terms', label: '词条与短句' },
  { key: 'translations', label: '候选译文' },
  { key: 'contributors', label: '社区贡献者' },
] as const
onMounted(async () => {
  try {
    stats.value = await api<Stats>('/api/stats')
  } catch {
    /* Public introduction remains usable offline. */
  }
})
</script>
<template>
  <section class="home-hero">
    <el-tag type="success" effect="light" round>开放的游戏翻译基础设施</el-tag>
    <h1>
      让每一次翻译，
      <br />
      <span>成为下一次的答案。</span>
    </h1>
    <p>
      NSTrans 汇集游戏短句、人物名、地名与专有名词，为实时 OCR 翻译客户端提供持续完善的共享词库。
    </p>
    <div class="hero-actions">
      <RouterLink to="/download">
        <el-button type="primary" size="large">下载 NSTrans</el-button>
      </RouterLink>
      <RouterLink to="/client"><el-button size="large">查看客户端说明</el-button></RouterLink>
    </div>
    <el-alert
      title="只想使用词库？客户端可以匿名下载公开词库，无需注册或登录本站。"
      type="info"
      :closable="false"
      show-icon
    />
  </section>
  <section class="stats-grid" aria-label="社区数据">
    <el-card v-for="metric in metrics" :key="metric.key" shadow="never">
      <el-statistic :title="metric.label" :value="stats?.[metric.key] ?? '—'" />
    </el-card>
  </section>
</template>
