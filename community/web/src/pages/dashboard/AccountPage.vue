<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { auth } from '../../services/auth'
import { write, errorText } from '../../services/api'
import PageHeader from '../../components/PageHeader.vue'
const form = reactive({ username: auth.user?.login || '', password: '', confirm: '' }),
  profileBusy = ref(false),
  passwordBusy = ref(false)
watch(
  () => auth.user?.login,
  (value) => {
    form.username = value || ''
  },
)
async function profile() {
  if (profileBusy.value) return
  if (!/^[\p{L}\p{N}_-]{3,32}$/u.test(form.username.trim()))
    return void ElMessage.warning('用户名需为 3–32 个中英文字、数字、下划线或连字符')
  profileBusy.value = true
  try {
    const result = await write<{ username: string }>('/api/account/profile', 'PATCH', {
      username: form.username.trim(),
    })
    if (auth.user) auth.user.login = result.username
    ElMessage.success('用户名已保存')
  } catch (e) {
    ElMessage.error(errorText(e))
  } finally {
    profileBusy.value = false
  }
}
async function password() {
  if (passwordBusy.value) return
  if (form.password.length < 10 || form.password.length > 128)
    return void ElMessage.warning('密码长度需为 10–128 个字符')
  if (form.password !== form.confirm) return void ElMessage.warning('两次输入的密码不一致')
  passwordBusy.value = true
  try {
    await write('/api/account/password', 'POST', { password: form.password })
    form.password = ''
    form.confirm = ''
    ElMessage.success('密码已设置，可在官方客户端使用')
  } catch (e) {
    ElMessage.error(errorText(e))
  } finally {
    passwordBusy.value = false
  }
}
</script>
<template>
  <div class="page-stack">
    <PageHeader
      eyebrow="ACCOUNT"
      title="账号与绑定"
      description="管理显示名称和客户端密码，关联 GitHub 以使用同一个社区账号。"
    />
    <div class="grid-two">
      <el-card shadow="never">
        <template #header><h2>显示用户名</h2></template>
        <el-form label-position="top" @submit.prevent="profile">
          <el-form-item label="用户名">
            <el-input v-model="form.username" maxlength="32" autocomplete="username" />
          </el-form-item>
          <p class="muted">3–32 个中英文字、数字、下划线或连字符。</p>
          <el-button type="primary" native-type="submit" :loading="profileBusy">
            保存用户名
          </el-button>
        </el-form>
      </el-card>
      <el-card shadow="never">
        <template #header><h2>GitHub 账号</h2></template>
        <el-result
          v-if="auth.user?.github_bound"
          icon="success"
          title="已绑定 GitHub"
          sub-title="GitHub 授权和客户端密码登录均进入同一账号。"
        />
        <template v-else>
          <p>绑定 GitHub 后，可在网页使用 OAuth 登录，并保留当前词库贡献记录。</p>
          <a href="/auth/github?intent=bind"><el-button type="primary">绑定 GitHub ↗</el-button></a>
        </template>
      </el-card>
    </div>
    <el-card shadow="never">
      <template #header><h2>客户端密码</h2></template>
      <p class="muted">设置后可在官方客户端用用户名与密码登录。网页继续通过 GitHub 授权登录。</p>
      <el-form label-position="top" class="narrow-form" @submit.prevent="password">
        <el-form-item label="新密码">
          <el-input
            v-model="form.password"
            type="password"
            show-password
            autocomplete="new-password"
            maxlength="128"
          />
        </el-form-item>
        <el-form-item label="确认新密码">
          <el-input
            v-model="form.confirm"
            type="password"
            show-password
            autocomplete="new-password"
            maxlength="128"
          />
        </el-form-item>
        <el-button type="primary" native-type="submit" :loading="passwordBusy">设置密码</el-button>
      </el-form>
    </el-card>
  </div>
</template>
