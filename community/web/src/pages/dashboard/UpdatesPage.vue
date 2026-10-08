<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, write, errorText } from '../../services/api'
import type { Policy } from '../../services/types'
import PageHeader from '../../components/PageHeader.vue'
import LoadError from '../../components/LoadError.vue'
const form = reactive({
    targetVersion: '1.0.1',
    popupEnabled: false,
    forceUpdate: false,
    content: '',
    downloadUrl: 'https://nstrans.221129.xyz/download',
  }),
  loading = ref(false),
  saving = ref(false),
  error = ref('')
watch(
  () => form.forceUpdate,
  (value) => {
    if (value) form.popupEnabled = true
  },
)
async function load() {
  loading.value = true
  error.value = ''
  try {
    const { policy } = await api<{ policy: Policy | null }>('/api/admin/update-policy')
    if (policy)
      Object.assign(form, {
        targetVersion: policy.target_version,
        popupEnabled: Boolean(policy.popup_enabled),
        forceUpdate: Boolean(policy.force_update),
        content: policy.content,
        downloadUrl: policy.download_url,
      })
  } catch (e) {
    error.value = errorText(e)
  } finally {
    loading.value = false
  }
}
async function save() {
  if (saving.value || loading.value) return
  if (!/^\d+\.\d+\.\d+(?:[-+].*)?$/u.test(form.targetVersion.trim()) || !form.content.trim())
    return void ElMessage.warning('请填写正确版本号与弹窗内容')
  try {
    if (new URL(form.downloadUrl).protocol !== 'https:') throw new Error()
  } catch {
    return void ElMessage.warning('下载地址必须为有效 HTTPS 地址')
  }
  if (form.forceUpdate) {
    try {
      await ElMessageBox.confirm(
        '低于目标版本的客户端将被强制要求更新，且无法关闭弹窗。确定发布？',
        '确认强制更新',
        { type: 'warning', confirmButtonText: '发布规则', cancelButtonText: '取消' },
      )
    } catch {
      return
    }
  }
  saving.value = true
  try {
    await write('/api/admin/update-policy', 'PATCH', form)
    ElMessage.success('版本通知规则已保存')
  } catch (e) {
    ElMessage.error(errorText(e))
  } finally {
    saving.value = false
  }
}
onMounted(load)
</script>
<template>
  <div class="page-stack">
    <PageHeader
      eyebrow="ADMIN"
      title="版本通知"
      description="仅管理员可修改。规则对低于目标版本的官方客户端生效。"
    />
    <LoadError :error="error" @retry="load" />
    <el-card v-if="!error" v-loading="loading" shadow="never">
      <el-form label-position="top" @submit.prevent="save">
        <div class="grid-two">
          <el-form-item label="目标版本">
            <el-input v-model="form.targetVersion" maxlength="40" placeholder="例如 1.0.1" />
          </el-form-item>
          <el-form-item label="下载地址">
            <el-input v-model="form.downloadUrl" maxlength="600" />
          </el-form-item>
        </div>
        <div class="setting-row">
          <div>
            <h3>强制更新</h3>
            <p class="muted">开启后锁定显示弹窗，客户端不可关闭。</p>
          </div>
          <el-switch v-model="form.forceUpdate" aria-label="强制更新" />
        </div>
        <div class="setting-row">
          <div>
            <h3>显示更新弹窗</h3>
            <p class="muted">普通更新允许用户关闭提示。</p>
          </div>
          <el-switch
            v-model="form.popupEnabled"
            :disabled="form.forceUpdate"
            aria-label="显示更新弹窗"
          />
        </div>
        <el-form-item label="弹窗内容">
          <el-input
            v-model="form.content"
            type="textarea"
            :rows="6"
            maxlength="2000"
            show-word-limit
            placeholder="说明更新内容及建议操作"
          />
        </el-form-item>
        <el-button type="primary" native-type="submit" :loading="saving" :disabled="loading">
          保存规则
        </el-button>
      </el-form>
    </el-card>
    <el-card shadow="never">
      <template #header><h2>客户端提示预览</h2></template>
      <div class="button-row">
        <el-tag>{{ form.targetVersion }}</el-tag>
        <el-tag :type="form.forceUpdate ? 'danger' : 'info'">
          {{ form.forceUpdate ? '强制更新' : form.popupEnabled ? '可关闭提示' : '不显示弹窗' }}
        </el-tag>
      </div>
      <p class="preserve-lines">{{ form.content || '填写内容后在这里预览。' }}</p>
    </el-card>
  </div>
</template>
