<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox, type SelectInstance } from 'element-plus'
import { api, write, errorText } from '../../services/api'
import PageHeader from '../../components/PageHeader.vue'
import LoadError from '../../components/LoadError.vue'
import RelayRouteQueue from '../../components/RelayRouteQueue.vue'
type Model = {
  id: string
  platform?: string
  model?: string
  keyId?: string
  capability: string
  enabled: boolean
  translationCost: number
  searchCost: number
  visionCost: number
}
type Credential = { id: string; name: string; platform: string; workspace: string }
type CatalogModel = { id: string; name: string; vision: boolean; search: boolean }
const credentials = ref<Credential[]>([]), catalog = ref<CatalogModel[]>([])
const keyDialog = ref(false), modelDialog = ref(false), discovering = ref(false), keySaving = ref(false)
const keyForm = reactive({id:'',name:'',platform:'google',workspace:'',apiKey:''})
const modelForm = reactive({id:'',platform:'google',keyId:'',model:''})
const selectedModelIds = ref<string[]>([])
const modelSelect = ref<SelectInstance>()
const platformNames: Record<string,string> = {google:'Google Gemini',bailian:'阿里百炼（千问）',deepseek:'DeepSeek'}
let discoveryRevision=0
function editKey(key?: Credential) {
  Object.assign(keyForm,{id:'',name:'',platform:'google',workspace:'',apiKey:''},key || {})
  keyDialog.value=true
}
async function saveKey() {
  if (keySaving.value) return
  keySaving.value=true
  try {
    await write('/api/admin/relay/credentials',keyForm.id?'PATCH':'POST',keyForm)
    keyForm.apiKey=''; keyDialog.value=false; await load(); ElMessage.success('密钥已加密保存')
  } catch(e) { ElMessage.error(errorText(e)) }
  finally { keySaving.value=false }
}
async function deleteKey(key:Credential) {
  try { await ElMessageBox.confirm(`删除密钥“${key.name}”？使用中的密钥需先删除对应模型。`,'删除密钥') } catch { return }
  try { await write('/api/admin/relay/credentials','DELETE',{id:key.id}); await load() } catch(e) { ElMessage.error(errorText(e)) }
}
async function editModel(model?:Model) {
  Object.assign(modelForm,{id:'',platform:'google',keyId:'',model:''},model || {})
  selectedModelIds.value=model?.model ? [model.model] : []
  catalog.value=[]; modelDialog.value=true
  if (modelForm.keyId) await discover()
}
async function discover() {
  const revision=++discoveryRevision
  catalog.value=[]
  if (!modelForm.keyId) { discovering.value=false; return }
  discovering.value=true
  try { const result=await write<{models:CatalogModel[]}>('/api/admin/relay/discover','POST',{keyId:modelForm.keyId}); if (revision===discoveryRevision) catalog.value=result.models }
  catch(e) { if (revision===discoveryRevision) ElMessage.error(errorText(e)) }
  finally { if (revision===discoveryRevision) discovering.value=false }
}
function addModel() {
  if (saving.value) return
  const entries=selectedModelIds.value.map(id=>catalog.value.find(m=>m.id===id))
  if (!entries.length || entries.some(entry=>!entry)) { ElMessage.warning('请从官方目录选择模型'); return }
  const additions=entries.filter(entry=>!config.models.some(m=>m.id!==modelForm.id && m.platform===modelForm.platform && m.keyId===modelForm.keyId && m.model===entry!.id))
  if (modelForm.id && additions.length!==entries.length) { ElMessage.warning('此密钥下已添加该模型'); return }
  if (!additions.length) { ElMessage.info('所选模型均已添加'); return }
  if (config.models.length + (modelForm.id ? 0 : additions.length)>100) { ElMessage.warning('最多配置 100 个模型，请减少选择数量'); return }
  const previous=config.models.find(m=>m.id===modelForm.id)
  for (const entry of additions) {
    if (!entry) continue
    const value:Model={...modelForm,model:entry.id,id:modelForm.id||crypto.randomUUID(),enabled:previous?.enabled??true,
    capability:entry.vision?(entry.search?'multimodal-search':'vision-only'):(entry.search?'search-only':'translation-only'),
    translationCost:previous?.translationCost||1,searchCost:previous?.searchCost||2,visionCost:previous?.visionCost||2}
    if (previous) Object.assign(previous,value); else config.models.push(value)
  }
  for (const purpose of ['translation','search','vision'] as const) {
    config.routes[purpose]=config.routes[purpose].filter(id=>eligibleModels(purpose).some(m=>m.id===id))
  }
  modelDialog.value=false
  void save()
}
async function deleteModel(model:Model) {
  try { await ElMessageBox.confirm(`删除模型 ${model.model || model.id}？对应的用途路由也会清空。`,'删除模型') } catch { return }
  config.models=config.models.filter(m=>m.id!==model.id)
  for (const purpose of ['translation','search','vision'] as const) config.routes[purpose]=config.routes[purpose].filter(id=>id!==model.id)
  if (!config.models.length) config.enabled=false
  await save()
}
type QuotaUser = {
  id: number
  login: string
  balance: number
  granted: number
  spent: number
  pending: number
}
type Usage = {
  id: string
  login: string
  model: string
  purpose: string
  cost: number
  status: string
  input_tokens: number
  output_tokens: number
  cached_tokens: number
  duration_ms: number
  created_at: string
  error_code: string
  attempts_json?: string
}
function attemptsFor(row:Usage): {model:string;status:string;error?:string;durationMs:number}[] {
  try { const value=JSON.parse(row.attempts_json || '[]');return Array.isArray(value)?value:[] } catch { return [] }
}
const tab = ref('config'),
  loading = ref(false),
  saving = ref(false),
  error = ref('')
const config = reactive({
  enabled: false,
  routes: { translation: [] as string[], search: [] as string[], vision: [] as string[] },
  apiKey: '',
  keyConfigured: false,
  clearKey: false,
  maxConcurrency: 2,
  models: [] as Model[],
})
const users = ref<QuotaUser[]>([]),
  selected = ref<QuotaUser[]>([]),
  query = ref(''),
  userPage = ref(1),
  userTotal = ref(0)
const grants = reactive({ amount: 10, note: '' })
const usage = ref<Usage[]>([]),
  usagePage = ref(1),
  usageTotal = ref(0),
  usageUser = ref<number | undefined>()
const summary = ref({ requests: 0, inputTokens: 0, outputTokens: 0, points: 0 })
const labels: Record<string, string> = {
  'multimodal-search': '文本、视觉 + 搜索',
  'search-only': '文本 + 搜索',
  'translation-only': '仅翻译',
  'vision-only': '文本、视觉（无搜索）',
  translation: '翻译',
  search: '搜索',
  vision: '视觉',
  reserved: '处理中',
  success: '成功',
  failed: '失败（已退款）',
  uncertain: '需核查（点数保留）',
}
async function load() {
  loading.value = true
  error.value = ''
  try {
    if (tab.value === 'config') {
      Object.assign(config, await api('/api/admin/relay/config'), { apiKey: '', clearKey: false })
      for (const purpose of ['translation','search','vision'] as const) {
        const value=config.routes[purpose] as string[] | string
        config.routes[purpose]=Array.isArray(value)?value:value?[value]:[]
      }
      credentials.value=(await api<{credentials:Credential[]}>('/api/admin/relay/credentials')).credentials
    }
    else if (tab.value === 'users') {
      const data = await api<{ users: QuotaUser[]; total: number }>(
        `/api/admin/relay/users?q=${encodeURIComponent(query.value)}&page=${userPage.value}`,
      )
      users.value = data.users
      userTotal.value = data.total
      selected.value = []
    } else {
      const data = await api<{ usage: Usage[]; total: number; summary: typeof summary.value }>(
        `/api/admin/relay/usage?page=${usagePage.value}&userId=${usageUser.value || ''}`,
      )
      usage.value = data.usage
      usageTotal.value = data.total
      summary.value = data.summary
    }
  } catch (e) {
    error.value = errorText(e)
  } finally {
    loading.value = false
  }
}
async function save() {
  if (saving.value) return
  saving.value = true
  try {
    await write('/api/admin/relay/config', 'PATCH', config)
    config.apiKey = ''
    ElMessage.success('中转模型配置已保存')
    await load()
  } catch (e) {
    ElMessage.error(errorText(e))
  } finally {
    saving.value = false
  }
}
function eligibleModels(purpose:'translation'|'search'|'vision') {
  return config.models.filter(m=>m.enabled && (purpose==='vision'?['multimodal-search','vision-only'].includes(m.capability):purpose==='search'?['multimodal-search','search-only'].includes(m.capability):true))
}
async function grant(targets: QuotaUser[], clear=false) {
  if (!targets.length || saving.value) return
  if (!clear && (!Number.isSafeInteger(grants.amount) || grants.amount===0)) { ElMessage.warning('调整点数须为非零整数'); return }
  try {
    await ElMessageBox.confirm(
      clear ? `清空 ${targets.length} 个用户的剩余额度？累计分配和消耗记录将保留。` : `为 ${targets.length} 个用户每人${grants.amount>0?'追加':'扣减'} ${Math.abs(grants.amount)} 社区点数？扣减最多至余额为零。`,
      clear ? '确认清空额度' : '确认额度调整',
      { type: 'warning' },
    )
  } catch {
    return
  }
  saving.value = true
  try {
    await write('/api/admin/relay/grants', 'POST', {
      userIds: targets.map((user) => user.id),
      ...grants,
      action: clear ? 'clear' : 'adjust',
    })
    ElMessage.success(clear ? '额度已清空' : '额度已调整')
    await load()
  } catch (e) {
    ElMessage.error(errorText(e))
  } finally {
    saving.value = false
  }
}
function viewUsage(user: QuotaUser) {
  usageUser.value = user.id
  usagePage.value = 1
  tab.value = 'usage'
  void load()
}
onMounted(load)
function searchUsers() {
  userPage.value = 1
  void load()
}
function filterUsage() {
  usagePage.value = 1
  void load()
}
function allUsage() {
  usageUser.value = undefined
  filterUsage()
}
</script>
<template>
  <div class="page-stack">
    <PageHeader
      eyebrow="ADMIN"
      title="社区中转模型与额度"
      description="统一管理上游密钥、模型白名单和用户社区点数。上游密钥不会下发客户端。"
    />
    <el-alert
      title="社区点数与上游额度独立"
      description="客户端只使用社区中转模型，由服务器按用途选型。按下表固定点数计费，Token 用量单独记录；明确上游失败会退款，超时或中断保留点数并标记需核查。Google 免费层可能使用输入和回答改进产品，实际配额以项目控制台为准。"
      type="warning"
      :closable="false"
      show-icon
    />
    <el-tabs v-model="tab" @tab-change="load">
      <el-tab-pane label="代理配置" name="config" />
      <el-tab-pane label="用户额度" name="users" />
      <el-tab-pane label="用量记录" name="usage" />
    </el-tabs>
    <LoadError :error="error" @retry="load" />
    <el-card v-if="tab === 'config'" v-loading="loading" shadow="never">
      <el-form label-position="top" @submit.prevent="save">
        <div class="setting-row">
          <div>
            <h3>启用社区中转模型</h3>
            <p class="muted">填写密钥并保存后生效；关闭后所有新请求停止。</p>
          </div>
          <el-switch v-model="config.enabled" aria-label="启用社区中转模型" />
        </div>
        <h3>按用途配置模型优先级与故障转移</h3>
        <p class="muted">每个用途最多 5 个模型，拖拽排序；也可点击上下箭头。由上到下依次尝试，每个模型最多尝试一次。每次请求按首选可用模型点数仅扣一次，切换不叠加。多模型时每次尝试最长 30 秒，总时限 110 秒；内容安全拒绝不会绕过。</p>
        <el-form-item v-for="purpose in ['translation','search','vision'] as const" :key="purpose" :label="labels[purpose]">
          <RelayRouteQueue v-model="config.routes[purpose]" :models="eligibleModels(purpose)" :label="labels[purpose] || purpose" />
        </el-form-item>
        <p class="muted">
          从官方目录选择模型，按用途路由，不向客户端下发具体型号。目录列出不等于账号已开通付费权限。
          DeepSeek 未声明内置联网搜索，因此不能用于搜索路由；视觉能力按官方元数据判断。
        </p>
        <div class="button-row"><h3>平台密钥</h3><el-button @click="editKey()">添加密钥</el-button></div>
        <el-table :data="credentials">
          <el-table-column prop="name" label="名称" min-width="160" />
          <el-table-column label="平台" min-width="150"><template #default="{row}">{{ platformNames[row.platform] }}</template></el-table-column>
          <el-table-column label="操作" width="160"><template #default="{row}"><el-button link type="primary" @click="editKey(row)">编辑</el-button><el-button link type="danger" @click="deleteKey(row)">删除</el-button></template></el-table-column>
        </el-table>
        <el-form-item label="全站最大并发（同时每个用户最多两次）">
          <el-input-number v-model="config.maxConcurrency" :min="1" :max="8" />
        </el-form-item>
        <div class="button-row"><h3>允许调用的模型与点数</h3><el-button type="primary" @click="editModel()">添加模型</el-button></div>
        <p class="muted">
          每次调用只收取对应用途列的点数，不叠加。仅翻译模型不接受搜索；纯文本模型不接受截图。
        </p>
        <el-table :data="config.models">
          <el-table-column label="模型" min-width="160">
            <template #default="{ row }">
              <strong>{{ row.model || row.id }}</strong><div class="muted">{{ platformNames[row.platform || 'google'] }} · {{ credentials.find(k=>k.id===row.keyId)?.name || '原密钥' }}</div>
            </template>
          </el-table-column>
          <el-table-column label="启用" width="80">
            <template #default="{ row }">
              <el-switch v-model="row.enabled" :aria-label="`启用 ${row.id}`" />
            </template>
          </el-table-column>
          <el-table-column label="能力" min-width="190">
            <template #default="{ row }">
              {{ labels[row.capability] }}
            </template>
          </el-table-column>
          <el-table-column
            v-for="field in ['translationCost', 'searchCost', 'visionCost'] as const"
            :key="field"
            :label="
              field === 'translationCost'
                ? '翻译点数'
                : field === 'searchCost'
                  ? '搜索点数'
                  : '视觉点数'
            "
            width="145"
          >
            <template #default="{ row }">
              <el-input-number
                v-model="row[field]"
                :min="1"
                :max="100000"
                controls-position="right"
                :disabled="
                  (field === 'visionCost' && !['multimodal-search','vision-only'].includes(row.capability)) ||
                  (field === 'searchCost' && !['multimodal-search','search-only'].includes(row.capability))
                "
                style="width: 125px"
              />
            </template>
          </el-table-column>
          <el-table-column label="操作" width="150"><template #default="{row}"><el-button link type="primary" @click="editModel(row)">编辑</el-button><el-button link type="danger" @click="deleteModel(row)">删除</el-button></template></el-table-column>
        </el-table>
        <div class="button-row" style="margin-top: 20px">
          <el-button
            type="primary"
            native-type="submit"
            :loading="saving"
            :disabled="loading || !!error"
          >
            保存配置
          </el-button>
          <a
            href="https://help.aliyun.com/zh/model-studio/web-search"
            target="_blank"
            rel="noopener noreferrer"
          >
            官方联网搜索文档 ↗
          </a>
        </div>
      </el-form>
    </el-card>
    <el-dialog v-model="keyDialog" title="平台密钥" width="min(520px, 94vw)">
      <el-form label-position="top" @submit.prevent="saveKey">
        <el-form-item label="平台"><el-select v-model="keyForm.platform" :disabled="!!keyForm.id"><el-option v-for="(name,id) in platformNames" :key="id" :label="name" :value="id" /></el-select></el-form-item>
        <el-form-item label="密钥名称"><el-input v-model="keyForm.name" maxlength="100" /></el-form-item>
        <el-form-item v-if="keyForm.platform==='bailian'" label="北京业务空间 ID（非 Token Plan）"><el-input v-model="keyForm.workspace" maxlength="80" /></el-form-item>
        <el-form-item :label="keyForm.id?'API Key（留空保持不变）':'API Key'"><el-input v-model="keyForm.apiKey" type="password" show-password autocomplete="new-password" maxlength="512" /></el-form-item>
        <el-button type="primary" native-type="submit" :loading="keySaving">保存密钥</el-button>
      </el-form>
    </el-dialog>
    <el-dialog v-model="modelDialog" title="选择官方模型" width="min(600px, 94vw)">
      <el-form label-position="top" @submit.prevent="addModel">
        <el-form-item label="平台"><el-select v-model="modelForm.platform" @change="modelForm.keyId='';selectedModelIds=[];discover()"><el-option v-for="(name,id) in platformNames" :key="id" :label="name" :value="id" /></el-select></el-form-item>
        <el-form-item label="已保存的密钥"><el-select v-model="modelForm.keyId" @change="selectedModelIds=[];discover()"><el-option v-for="key in credentials.filter(k=>k.platform===modelForm.platform)" :key="key.id" :label="key.name" :value="key.id" /></el-select></el-form-item>
        <el-form-item :label="modelForm.id ? '官方模型目录' : '官方模型目录（可搜索、多选）'">
          <el-select ref="modelSelect" v-model="selectedModelIds" multiple filterable collapse-tags collapse-tags-tooltip :max-collapse-tags="3" :multiple-limit="modelForm.id ? 1 : 0" :reserve-keyword="true" :loading="discovering" placeholder="输入关键词搜索模型">
            <el-option v-for="model in catalog" :key="model.id" :label="model.id + (model.vision?' · 视觉':'') + (model.search?' · 搜索':'')" :value="model.id" />
            <template #footer><el-button type="primary" text @click="modelSelect?.blur()">完成选择（{{ selectedModelIds.length }}）</el-button></template>
          </el-select>
        </el-form-item>
        <p v-if="!modelForm.id" class="muted">已选 {{ selectedModelIds.length }} 个；相同平台、密钥下已添加的模型会自动跳过。</p>
        <div class="button-row"><el-button :loading="discovering" :disabled="!modelForm.keyId" @click="discover">刷新目录</el-button><el-button type="primary" native-type="submit" :loading="saving" :disabled="discovering || !selectedModelIds.length">{{ modelForm.id ? '保存模型' : `添加所选模型（${selectedModelIds.length}）` }}</el-button></div>
      </el-form>
    </el-dialog>
    <el-card v-if="tab === 'users'" v-loading="loading" shadow="never">
      <div class="button-row">
        <el-input
          v-model="query"
          placeholder="搜索用户名"
          clearable
          style="max-width: 280px"
          @keyup.enter="searchUsers"
        />
        <el-button @click="searchUsers">搜索</el-button>
        <el-button @click="load">刷新</el-button>
      </div>
      <div class="button-row" style="margin: 20px 0">
          <span>每人调整点数（负数扣减）</span>
          <el-input-number v-model="grants.amount" :min="-1000000" :max="1000000" :precision="0" />
        <el-input
          v-model="grants.note"
          maxlength="200"
          placeholder="分配备注（可选）"
          style="max-width: 260px"
        />
        <el-button
          type="primary"
          :disabled="!selected.length || loading || !!error"
          :loading="saving"
          @click="grant(selected)"
        >
          为选中 {{ selected.length }} 人调整
          </el-button>
          <el-button type="danger" plain :disabled="!selected.length || loading || !!error" :loading="saving" @click="grant(selected,true)">清空选中用户额度</el-button>
      </div>
      <el-table :data="users" row-key="id" @selection-change="selected = $event">
        <el-table-column type="selection" width="45" />
        <el-table-column prop="login" label="用户" min-width="160" />
        <el-table-column prop="balance" label="可用点数" />
        <el-table-column prop="granted" label="累计分配" />
        <el-table-column prop="spent" label="累计消耗" />
        <el-table-column prop="pending" label="进行中" />
          <el-table-column label="操作" width="220">
          <template #default="{ row }">
            <el-button link type="primary" :disabled="saving" @click="grant([row])">分配</el-button>
            <el-button link type="danger" :disabled="saving" @click="grant([row],true)">清空额度</el-button>
            <el-button link @click="viewUsage(row)">用量</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-pagination
        v-model:current-page="userPage"
        :page-size="50"
        :total="userTotal"
        layout="prev, pager, next, total"
        @current-change="load"
      />
    </el-card>
    <el-card v-if="tab === 'usage'" v-loading="loading" shadow="never">
      <div class="button-row">
        <span>用户 ID</span>
        <el-input-number v-model="usageUser" :min="1" placeholder="全部" />
        <el-button @click="filterUsage">筛选</el-button>
        <el-button @click="allUsage">全部用户</el-button>
      </div>
      <p>
        {{ summary.requests }} 次请求 · {{ summary.points }} 点 · 输入
        {{ summary.inputTokens }} Token · 输出 {{ summary.outputTokens }} Token
      </p>
        <el-table :data="usage">
          <el-table-column type="expand"><template #default="{row}">
            <el-table :data="attemptsFor(row)" style="padding:12px">
              <el-table-column prop="model" label="尝试模型" min-width="180" />
              <el-table-column label="结果" min-width="100"><template #default="{row:attempt}">{{ labels[attempt.status] || attempt.status }}</template></el-table-column>
              <el-table-column prop="error" label="故障代码" min-width="160" />
              <el-table-column prop="durationMs" label="耗时 ms" width="100" />
            </el-table>
          </template></el-table-column>
        <el-table-column prop="created_at" label="时间（UTC）" min-width="175" />
        <el-table-column prop="login" label="用户" min-width="130" />
        <el-table-column prop="model" label="模型" min-width="145" />
        <el-table-column label="用途" width="80">
          <template #default="{ row }">{{ labels[row.purpose] }}</template>
        </el-table-column>
        <el-table-column prop="cost" label="点数" width="70" />
        <el-table-column label="状态" min-width="170">
          <template #default="{ row }">
            <el-tag
              :type="
                row.status === 'success'
                  ? 'success'
                  : row.status === 'uncertain'
                    ? 'warning'
                    : 'info'
              "
            >
              {{ labels[row.status] }}
            </el-tag>
            <small class="muted">{{ row.error_code }}</small>
          </template>
        </el-table-column>
        <el-table-column prop="input_tokens" label="输入 Token" />
        <el-table-column prop="output_tokens" label="输出 Token" />
        <el-table-column prop="duration_ms" label="耗时 ms" />
      </el-table>
      <p class="muted">
        日志不保存原文、截图或模型输出。退款记录中的“点数”是预留量，不计入消耗汇总。
      </p>
      <el-pagination
        v-model:current-page="usagePage"
        :page-size="50"
        :total="usageTotal"
        layout="prev, pager, next, total"
        @current-change="load"
      />
    </el-card>
  </div>
</template>
