<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { copyText } from '../services/api'
const base = 'https://nstrans.221129.xyz'
const examples = [
  {
    title: '社区中转模型：服务状态与额度',
    method: 'GET',
    path: '/api/v1/relay/catalog',
    note: '使用客户端密钥，返回服务状态、各用途点数和账号额度，不返回上游型号。',
  },
  {
    title: '社区中转模型：翻译／搜索／视觉',
    method: 'POST',
    path: '/api/v1/relay',
    body: { purpose: 'translation', prompt: '将ゼルダ翻译成简体中文，只输出译名' },
    note: 'purpose 为 translation、search 或 vision，由服务器选型。视觉必须传 imageDataUrl（本地截图 base64，约 2MB）。返回 content、cost、quota、usage；搜索另返回 grounding（来源与 Google 搜索建议，调用方应显示）。不接受 model 或 enableSearch。额度不足返回 402；不要自动无限重试。',
  },
  {
    title: '获取游戏列表',
    method: 'GET',
    path: '/api/v1/games',
    public: true,
    note: '公开接口，无需密钥。返回游戏 ID、中文名、日文名与封面。',
  },
  {
    title: '新增游戏',
    method: 'POST',
    path: '/api/v1/games',
    body: {
      chineseName: '游戏中文名',
      japaneseName: 'ゲーム名',
      posterUrl: 'https://example.com/poster.jpg',
    },
    note: '仅中文名必填。日文名与封面可选，无需审核。',
  },
  {
    title: '按游戏 ID 批量获取词库',
    method: 'POST',
    path: '/api/v1/dictionaries/batch',
    body: { gameIds: ['general', 'zelda-totk'] },
    note: '最多 20 个游戏、10000 条候选译文。返回 termId、translationId、source、target、kind、score、updatedAt。',
  },
  {
    title: '覆盖单条词库数据',
    method: 'PATCH',
    path: '/api/v1/translations/123',
    body: { source: 'ゼルダ', target: '塞尔达' },
    note: '实际修改后可信度 +1；原文与译文均可更改。ID 使用查询返回的 translationId。',
  },
  {
    title: '批量覆盖词库数据',
    method: 'PATCH',
    path: '/api/v1/translations/batch',
    body: {
      items: [
        { translationId: 123, source: 'ゼルダ', target: '塞尔达' },
        { translationId: 124, target: '海拉鲁' },
      ],
    },
    note: '最多 100 条；每条实际修改 +1。重复或冲突由接口校验，查看各项返回结果。',
  },
  {
    title: '新增单条词库数据',
    method: 'POST',
    path: '/api/v1/translations',
    body: { gameId: 'zelda-totk', kind: 'term', source: 'ゼルダ', target: '塞尔达' },
    note: '新增可信度 +1。kind 可选 term（名词）或 phrase（短句）；完全重复不会重复加分。',
  },
  {
    title: '批量新增词库数据',
    method: 'POST',
    path: '/api/v1/translations/batch',
    body: {
      items: [
        { gameId: 'zelda-totk', kind: 'term', source: 'ゼルダ', target: '塞尔达' },
        { gameId: 'general', kind: 'phrase', source: '設定', target: '设置' },
      ],
    },
    note: '最多 100 条；新增各项 +1。每个原文最多 3 条候选译文，满额时覆盖最低评分，平分随机。',
  },
  {
    title: 'Wiki 镜像查询',
    method: 'POST',
    path: '/api/v1/wiki-mirror',
    body: { site: 'wikidata', params: { action: 'wbsearchentities', search: 'ゼルダ' } },
    note: '需要社区密钥。site 可选 ja、zh、wikidata；仅支持指定的 Wikimedia 只读搜索，不是任意 URL 代理。',
  },
]
function curl(item: (typeof examples)[number]) {
  return `curl '${base}${item.path}'${item.method !== 'GET' ? ` \\\n  -X ${item.method}` : ''}${!item.public ? ' \\\n  -H "Authorization: Bearer YOUR_CLIENT_KEY"' : ''}${'body' in item ? ` \\\n  -H 'Content-Type: application/json' \\\n  -d '${JSON.stringify(item.body)}'` : ''}`
}
async function copy(item: (typeof examples)[number]) {
  try {
    await copyText(curl(item))
    ElMessage.success('示例已复制，请替换密钥与词条 ID')
  } catch {
    ElMessage.error('复制失败，请手动复制示例')
  }
}
</script>
<template>
  <el-card shadow="never">
    <template #header>
      <div class="section-title">
        <h2>客户端 API 接入</h2>
        <el-tag>Bearer Key</el-tag>
      </div>
    </template>
    <p>
      受保护接口使用
      <code>Authorization: Bearer YOUR_CLIENT_KEY</code>
      。密钥拥有当前用户的词库写入权限，请勿放入公开仓库或发送给他人。
    </p>
    <el-alert
      title="评分 = 可信度：网页手动新增 / 编辑 +3，密钥 API 新增 / 编辑 +1，赞 / 踩按用户投票计分。相同数据不会重复加分。"
      type="info"
      :closable="false"
    />
    <el-collapse class="api-reference">
      <el-collapse-item
        v-for="(item, index) in examples"
        :key="item.path + item.method"
        :name="index"
      >
        <template #title>
          <div class="api-title">
            <el-tag
              :type="
                item.method === 'GET' ? 'success' : item.method === 'PATCH' ? 'warning' : 'primary'
              "
              size="small"
            >
              {{ item.method }}
            </el-tag>
            <span>{{ item.title }}</span>
          </div>
        </template>
        <p class="muted">{{ item.note }}</p>
        <div class="code-toolbar">
          <code>{{ item.path }}</code>
          <el-button size="small" @click="copy(item)">复制调用</el-button>
        </div>
        <pre><code>{{ curl(item) }}</code></pre>
      </el-collapse-item>
    </el-collapse>
    <p class="muted">
      公开单游戏词库也可通过 GET /api/v1/dictionaries/{gameId} 匿名获取。客户端自动学习上传使用 POST
      /api/v1/contributions，并受词条类型、来源与短句长度校验限制。
    </p>
  </el-card>
</template>
