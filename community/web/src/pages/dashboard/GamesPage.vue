<script setup lang="ts">
import { onMounted, reactive, ref, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, write, errorText } from '../../services/api'
import { auth } from '../../services/auth'
import type { Game } from '../../services/types'
import PageHeader from '../../components/PageHeader.vue'
import LoadError from '../../components/LoadError.vue'
const games = ref<Game[]>([]),
  query = ref(''),
  loading = ref(false),
  saving = ref(false),
  error = ref(''),
  dialog = ref(false),
  editing = ref<Game>(),
  deleting = ref('')
const form = reactive({ chineseName: '', japaneseName: '', posterUrl: '' })
const filtered = computed(() =>
  games.value.filter((game) =>
    `${game.chinese_name} ${game.japanese_name} ${game.id}`
      .toLocaleLowerCase()
      .includes(query.value.toLocaleLowerCase()),
  ),
)
async function load() {
  loading.value = true
  error.value = ''
  try {
    games.value = (await api<{ games: Game[] }>('/api/games')).games
  } catch (e) {
    error.value = errorText(e)
  } finally {
    loading.value = false
  }
}
function open(game?: Game) {
  editing.value = game
  Object.assign(form, {
    chineseName: game?.chinese_name || '',
    japaneseName: game?.japanese_name || '',
    posterUrl: game?.poster_url || '',
  })
  dialog.value = true
}
async function save() {
  if (saving.value) return
  if (!form.chineseName.trim()) return void ElMessage.warning('请填写游戏中文名')
  if (form.posterUrl.trim()) {
    try {
      if (new URL(form.posterUrl).protocol !== 'https:') throw new Error()
    } catch {
      return void ElMessage.warning('封面地址必须为有效 HTTPS URL')
    }
  }
  saving.value = true
  try {
    await write(
      editing.value ? `/api/admin/games/${encodeURIComponent(editing.value.id)}` : '/api/games',
      editing.value ? 'PATCH' : 'POST',
      form,
    )
    dialog.value = false
    ElMessage.success(editing.value ? '游戏信息已更新' : '游戏创建成功，可立即使用')
    await load()
  } catch (e) {
    ElMessage.error(errorText(e))
  } finally {
    saving.value = false
  }
}
async function remove(game: Game) {
  try {
    await ElMessageBox.confirm(
      `将删除「${game.chinese_name}」及其全部词条、候选译文和评分，无法恢复。`,
      '删除游戏',
      { type: 'error', confirmButtonText: '确认删除', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  deleting.value = game.id
  try {
    await write(`/api/admin/games/${encodeURIComponent(game.id)}`, 'DELETE')
    ElMessage.success('游戏及词库已删除')
    await load()
  } catch (e) {
    ElMessage.error(errorText(e))
  } finally {
    deleting.value = ''
  }
}
onMounted(load)
</script>
<template>
  <div class="page-stack">
    <PageHeader
      eyebrow="GAMES"
      title="游戏管理"
      description="每个游戏对应独立词库。新游戏只需中文名，无需审核；管理员可编辑信息或删除游戏。"
    >
      <el-button type="primary" @click="open()">新增游戏</el-button>
    </PageHeader>
    <LoadError :error="error" @retry="load" />
    <el-card v-loading="loading" shadow="never">
      <div class="table-toolbar">
        <el-input
          v-model="query"
          placeholder="搜索中文名、日文名或游戏 ID"
          clearable
          aria-label="搜索游戏"
        />
        <span class="muted">{{ filtered.length }} 个游戏</span>
      </div>
      <el-table :data="filtered" table-layout="auto" empty-text="暂无匹配游戏">
        <el-table-column label="游戏" min-width="260">
          <template #default="{ row }">
            <div class="game-cell">
              <el-image v-if="row.poster_url" :src="row.poster_url" fit="cover" class="game-poster">
                <template #error><span class="poster-placeholder">游戏</span></template>
              </el-image>
              <div>
                <strong>{{ row.chinese_name }}</strong>
                <p class="muted">{{ row.japanese_name || '未填写日文名' }}</p>
                <code>{{ row.id }}</code>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag :type="row.id === 'general' ? 'info' : 'success'">
              {{ row.id === 'general' ? '通用词库' : '已开放' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" :min-width="auth.user?.role === 'admin' ? 245 : 110">
          <template #default="{ row }">
            <RouterLink :to="{ path: '/dashboard/dictionary', query: { game: row.id } }">
              <el-button text type="primary">查看词库</el-button>
            </RouterLink>
            <template v-if="auth.user?.role === 'admin'">
              <el-button text @click="open(row)">编辑</el-button>
              <el-button
                text
                type="danger"
                :disabled="row.id === 'general' || Boolean(deleting)"
                :loading="deleting === row.id"
                @click="remove(row)"
              >
                删除
              </el-button>
            </template>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
    <el-dialog
      v-model="dialog"
      :title="editing ? '编辑游戏信息' : '新增游戏'"
      width="min(520px, 92vw)"
      :close-on-click-modal="!saving"
      :show-close="!saving"
      :close-on-press-escape="!saving"
    >
      <el-form label-position="top" @submit.prevent="save">
        <el-form-item label="中文名（必填）">
          <el-input v-model="form.chineseName" maxlength="120" />
        </el-form-item>
        <el-form-item label="日文名（可选）">
          <el-input v-model="form.japaneseName" maxlength="120" />
        </el-form-item>
        <el-form-item label="封面 URL（可选）">
          <el-input v-model="form.posterUrl" maxlength="600" placeholder="https://…" />
        </el-form-item>
        <p class="muted">日文名可帮助客户端构造搜索关键词，封面必须使用 HTTPS。</p>
      </el-form>
      <template #footer>
        <el-button :disabled="saving" @click="dialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">
          {{ editing ? '保存修改' : '创建游戏' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>
