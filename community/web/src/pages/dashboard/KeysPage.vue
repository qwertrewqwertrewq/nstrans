<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageHeader from '../../components/PageHeader.vue'
import LoadError from '../../components/LoadError.vue'
import ApiReference from '../../components/ApiReference.vue'
import { api, write, errorText, formatDate, copyText } from '../../services/api'
import type { Key } from '../../services/types'
const keys = ref<Key[]>([]),
  loading = ref(false),
  busy = ref(false),
  revoking = ref<number>(),
  error = ref(''),
  newKey = ref('')
async function load() {
  loading.value = true
  error.value = ''
  try {
    keys.value = (await api<{ keys: Key[] }>('/api/keys')).keys
  } catch (e) {
    error.value = errorText(e)
  } finally {
    loading.value = false
  }
}
async function create() {
  if (busy.value) return
  busy.value = true
  try {
    newKey.value = (await write<{ key: string }>('/api/keys', 'POST')).key
    await load()
  } catch (e) {
    ElMessage.error(errorText(e))
  } finally {
    busy.value = false
  }
}
async function revoke(key: Key) {
  try {
    await ElMessageBox.confirm(
      '使用此密钥的客户端将无法继续上传词库或访问 Wiki 镜像。此操作不可撤销。',
      '撤销密钥',
      { type: 'warning', confirmButtonText: '撤销', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  revoking.value = key.id
  try {
    await write(`/api/keys/${key.id}`, 'DELETE')
    ElMessage.success('密钥已撤销')
    await load()
  } catch (e) {
    ElMessage.error(errorText(e))
  } finally {
    revoking.value = undefined
  }
}
async function copy() {
  try {
    await copyText(newKey.value)
    ElMessage.success('密钥已复制，请妥善保存')
  } catch {
    ElMessage.error('复制失败，请手动复制')
  }
}
onMounted(load)
onBeforeUnmount(() => {
  newKey.value = ''
})
</script>
<template>
  <div class="page-stack">
    <PageHeader
      eyebrow="ACCESS"
      title="客户端密钥"
      description="官方客户端登录后自动配置凭证。也可以为第三方集成生成密钥；每个账号最多保留 5 个有效密钥。"
    >
      <el-button
        type="primary"
        :loading="busy"
        :disabled="loading || keys.length >= 5 || Boolean(error)"
        @click="create"
      >
        生成新密钥
      </el-button>
    </PageHeader>
    <LoadError :error="error" @retry="load" />
    <el-card v-loading="loading" shadow="never">
      <el-table :data="keys" empty-text="尚未生成客户端密钥" table-layout="auto">
        <el-table-column label="密钥" min-width="210">
          <template #default="{ row }">
            <code>{{ row.key_prefix }}••••</code>
            <p v-if="row.origin === 'official-client'" class="muted">
              {{ row.device_name || 'NSTrans 官方客户端' }} · 自动配置
            </p>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" min-width="175">
          <template #default="{ row }">{{ formatDate(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="最近使用" min-width="175">
          <template #default="{ row }">{{ formatDate(row.last_used_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="90">
          <template #default="{ row }">
            <el-button
              type="danger"
              text
              :loading="revoking === row.id"
              :disabled="revoking !== undefined"
              @click="revoke(row)"
            >
              撤销
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
    <ApiReference />
    <el-dialog
      :model-value="Boolean(newKey)"
      title="请保存新密钥"
      width="min(540px, 92vw)"
      :close-on-click-modal="false"
      @close="newKey = ''"
    >
      <el-alert
        title="完整密钥只显示这一次；离开页面后无法再次查看。"
        type="warning"
        :closable="false"
      />
      <el-input :model-value="newKey" readonly class="key-field" aria-label="新客户端密钥" />
      <template #footer>
        <el-button @click="newKey = ''">已保存，关闭</el-button>
        <el-button type="primary" @click="copy">复制密钥</el-button>
      </template>
    </el-dialog>
  </div>
</template>
