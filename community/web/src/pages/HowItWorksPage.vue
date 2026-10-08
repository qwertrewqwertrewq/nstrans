<script setup lang="ts">
import PageHeader from '../components/PageHeader.vue'
const steps = [
  {
    title: '匿名读取',
    text: '客户端自动下载通用词库与当前游戏词库，不需要账号或 API Key。每个游戏独立维护，通用库自动加载。',
  },
  {
    title: '本地优先',
    text: '词库模式先对 OCR 文本进行完整和内部匹配，结合缓存减少重复翻译。专名未命中时再搜索，附带术语提示交给翻译模型。也可以选择直接翻译模式。',
  },
  {
    title: '主动共享',
    text: '共享默认关闭，由用户主动开启。只共享符合条件的专名、单词与菜单短标签，不上传完整对白或描述文本。',
  },
  {
    title: '社区校正',
    text: '同一原文最多保留三条不同译文。客户端取得可信度评分最高的版本；新候选超出上限时替换最低分项，同分时随机替换。',
  },
]
</script>
<template>
  <PageHeader
    eyebrow="HOW IT WORKS"
    title="模型解决第一次，词库解决之后每一次。"
    description="按游戏隔离的公共词库，让专有名词更准确，让后续翻译更稳定。"
  />
  <section class="two-column">
    <el-card v-for="(step, index) in steps" :key="step.title" shadow="never">
      <span class="section-index">0{{ index + 1 }}</span>
      <h2>{{ step.title }}</h2>
      <p>{{ step.text }}</p>
    </el-card>
  </section>
  <el-card shadow="never" class="section-space">
    <h2>评分只有一种含义：译文可信度</h2>
    <el-descriptions :column="1" border>
      <el-descriptions-item label="社区评价">赞 +1，踩 −1</el-descriptions-item>
      <el-descriptions-item label="网页手动操作">新增或修改 +3</el-descriptions-item>
      <el-descriptions-item label="客户端 API">
        新增或修改 +1；完全相同的重复提交不重复加分
      </el-descriptions-item>
    </el-descriptions>
    <p class="flow-text">OCR → 游戏词库与缓存 → 搜索术语 → 翻译模型 → 用户选择共享 → 社区校正</p>
    <RouterLink to="/client"><el-button type="primary">查看客户端接入</el-button></RouterLink>
  </el-card>
</template>
