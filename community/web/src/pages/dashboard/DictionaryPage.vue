<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import PageHeader from '../../components/PageHeader.vue'
import LoadError from '../../components/LoadError.vue'
import { api, write, errorText } from '../../services/api'
import type { Game, Term, Translation, TermsResponse, Exclusion } from '../../services/types'
const route = useRoute(),
  router = useRouter()
const games = ref<Game[]>([]),
  game = ref(''),
  query = ref(''),
  sort = ref('reading'),
  page = ref(1),
  size = ref(20)
const terms = ref<Term[]>([]),
  exclusions = ref<Exclusion[]>([]),
  exclusionCount = ref(0),
  error = ref(''),
  loading = ref(false),
  saving = ref(false),
  dialog = ref(false),
  voting = ref<number>()
const editing = ref<Translation>(),
  form = reactive({ source: '', target: '', kind: 'term' as 'term' | 'phrase' })
let timer: ReturnType<typeof setTimeout> | undefined,
  controller: AbortController | undefined,
  generation = 0,
  disposed = false
const collator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' })
const sorted = computed(() =>
  [...terms.value].sort((a, b) =>
    sort.value === 'score'
      ? best(b) - best(a) || collator.compare(a.source, b.source)
      : collator.compare(a.source, b.source),
  ),
)
const visible = computed(() =>
  sorted.value.slice((page.value - 1) * size.value, page.value * size.value),
)
function best(term: Term) {
  return Math.max(...term.translations.map((t) => t.score), -Infinity)
}
function candidates(term: Term) {
  return [...term.translations].sort((a, b) => b.score - a.score)
}
function cancel() {
  generation++
  controller?.abort()
  if (timer) clearTimeout(timer)
}
async function loadTerms() {
  cancel()
  if (!game.value) return
  const own = generation
  controller = new AbortController()
  loading.value = true
  error.value = ''
  try {
    const result = await api<TermsResponse>(
      `/api/games/${encodeURIComponent(game.value)}/terms?q=${encodeURIComponent(query.value.trim())}`,
      { signal: controller.signal },
    )
    if (own !== generation || disposed) return
    terms.value = result.terms
    exclusions.value = result.searchExclusions || []
    exclusionCount.value = result.searchExclusionCount || 0
    page.value = 1
  } catch (e) {
    if (own === generation && !disposed && !(e instanceof Error && e.name === 'AbortError'))
      error.value = errorText(e)
  } finally {
    if (own === generation && !disposed) loading.value = false
  }
}
async function load() {
  loading.value = true
  error.value = ''
  try {
    games.value = (await api<{ games: Game[] }>('/api/games')).games
    if (disposed) return
    const desired = typeof route.query.game === 'string' ? route.query.game : game.value
    const next =
      games.value.find((g) => g.id === desired)?.id ||
      games.value.find((g) => g.id !== 'general')?.id ||
      games.value[0]?.id ||
      ''
    if (game.value !== next) game.value = next
    else await loadTerms()
    if (!next) loading.value = false
  } catch (e) {
    error.value = errorText(e)
    loading.value = false
  }
}
watch(game, () => {
  terms.value = []
  exclusions.value = []
  page.value = 1
  dialog.value = false
  void router.replace({ path: route.path, query: { ...route.query, game: game.value } })
  void loadTerms()
})
watch(
  () => route.query.game,
  (value) => {
    if (
      typeof value === 'string' &&
      value !== game.value &&
      games.value.some((g) => g.id === value)
    )
      game.value = value
  },
)
watch(query, () => {
  cancel()
  loading.value = true
  page.value = 1
  timer = setTimeout(() => void loadTerms(), 300)
})
watch([sort, size], () => {
  page.value = 1
})
function open(term?: Term, translation?: Translation) {
  editing.value = translation
  Object.assign(form, {
    source: term?.source || '',
    target: translation?.target || '',
    kind: term?.kind || 'term',
  })
  dialog.value = true
}
async function save() {
  if (saving.value) return
  if (!form.source.trim() || !form.target.trim())
    return void ElMessage.warning('原文与译文均不能为空')
  const selected = game.value
  saving.value = true
  try {
    const result = await write<{ unchanged?: boolean }>(
      editing.value
        ? `/api/translations/${editing.value.id}`
        : `/api/games/${encodeURIComponent(selected)}/terms`,
      editing.value ? 'PATCH' : 'POST',
      { source: form.source.trim(), target: form.target.trim(), kind: form.kind },
    )
    ElMessage.success(result.unchanged ? '数据相同，未重复加分' : '词条已保存，可信度 +3')
    dialog.value = false
    if (selected === game.value) await loadTerms()
  } catch (e) {
    ElMessage.error(errorText(e))
  } finally {
    saving.value = false
  }
}
async function vote(translation: Translation, value: 1 | -1) {
  if (voting.value !== undefined) return
  voting.value = translation.id
  try {
    const result = await write<{ score: number }>(
      `/api/translations/${translation.id}/vote`,
      'POST',
      { value },
    )
    translation.score = result.score
    ElMessage.success('评分已更新')
  } catch (e) {
    ElMessage.error(errorText(e))
  } finally {
    voting.value = undefined
  }
}
onMounted(load)
onBeforeUnmount(() => {
  disposed = true
  cancel()
})
</script>
<template>
  <div class="page-stack">
    <PageHeader
      eyebrow="DICTIONARY"
      title="词库与评分"
      description="每条原文最多对应 3 个候选译文。评分为可信度，客户端优先使用评分最高的译文。"
    >
      <el-button type="primary" :disabled="!game || loading || Boolean(error)" @click="open()">
        新增词条 · +3
      </el-button>
    </PageHeader>
    <LoadError :error="error" @retry="load" />
    <el-card shadow="never">
      <div class="dictionary-filters">
        <el-select
          v-model="game"
          placeholder="选择游戏"
          aria-label="选择游戏词库"
          :disabled="saving"
        >
          <el-option
            v-for="item in games"
            :key="item.id"
            :label="item.chinese_name"
            :value="item.id"
          />
        </el-select>
        <el-input
          v-model="query"
          placeholder="搜索原文或译文"
          maxlength="80"
          clearable
          aria-label="搜索词条"
          :disabled="!game"
        />
        <el-select v-model="sort" aria-label="词条排序">
          <el-option label="按日语读音顺序" value="reading" />
          <el-option label="按最高评分" value="score" />
        </el-select>
      </div>
      <p class="muted">
        日语排序使用日语区域比较规则；片假名按读音顺序排列，汉字未注音时按字符比较。接口每次最多返回
        3000 条候选记录，较大词库请使用搜索缩小范围。
      </p>
      <div v-loading="loading" class="term-list">
        <el-empty v-if="!visible.length && !loading && !error" description="暂无匹配词条" />
        <article v-for="term in visible" :key="term.id" class="term-card">
          <header class="term-heading">
            <h3>{{ term.source }}</h3>
            <el-tag size="small" :type="term.kind === 'term' ? 'primary' : 'info'">
              {{ term.kind === 'term' ? '名词' : '短句' }}
            </el-tag>
          </header>
          <div
            v-for="(translation, index) in candidates(term)"
            :key="translation.id"
            class="translation-row"
          >
            <div class="translation-value">
              <strong>{{ translation.target }}</strong>
              <el-tag v-if="index === 0" type="success" size="small">最高评分</el-tag>
            </div>
            <div class="translation-actions">
              <el-tag :type="translation.score >= 0 ? 'success' : 'danger'">
                可信度 {{ translation.score }}
              </el-tag>
              <el-button-group>
                <el-button
                  :disabled="voting !== undefined"
                  :loading="voting === translation.id"
                  :aria-label="`赞 ${translation.target}`"
                  @click="vote(translation, 1)"
                >
                  赞
                </el-button>
                <el-button
                  :disabled="voting !== undefined"
                  :aria-label="`踩 ${translation.target}`"
                  @click="vote(translation, -1)"
                >
                  踩
                </el-button>
              </el-button-group>
              <el-button :disabled="saving" @click="open(term, translation)">编辑 · +3</el-button>
            </div>
          </div>
          <p v-if="!term.translations.length" class="muted">暂无候选译文</p>
        </article>
      </div>
      <el-pagination
        v-if="sorted.length"
        v-model:current-page="page"
        v-model:page-size="size"
        :page-sizes="[20, 50, 100]"
        :total="sorted.length"
        layout="total, prev, pager, next, sizes"
        class="table-pagination"
      />
    </el-card>
    <el-card v-if="game === 'general'" shadow="never">
      <template #header>
        <div class="section-title">
          <h2>通用片假名排除库</h2>
          <el-tag type="info">{{ exclusionCount }} 条</el-tag>
        </div>
      </template>
      <p class="muted">
        这里不包含翻译，仅用于排除常用片假名单词的专有名词搜索；客户端始终加载通用库。展示最多 500
        条，可使用上方搜索按原文查找。
      </p>
      <el-table :data="exclusions" max-height="400" empty-text="暂无匹配排除词">
        <el-table-column prop="source_text" label="原文" min-width="160" />
        <el-table-column label="公开来源" min-width="200">
          <template #default="{ row }">
            <a
              v-if="/^https?:\/\//u.test(row.source_url)"
              :href="row.source_url"
              target="_blank"
              rel="noreferrer"
            >
              {{ row.source_name || '查看来源' }} ↗
            </a>
            <span v-else>{{ row.source_name || '未注明' }}</span>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
    <el-dialog
      v-model="dialog"
      :title="editing ? '编辑词条 · 可信度 +3' : '新增词条 · 可信度 +3'"
      width="min(540px, 92vw)"
      :close-on-click-modal="!saving"
      :show-close="!saving"
      :close-on-press-escape="!saving"
    >
      <el-form label-position="top" @submit.prevent="save">
        <el-form-item label="原文">
          <el-input v-model="form.source" maxlength="32" show-word-limit />
        </el-form-item>
        <el-form-item label="中文译文">
          <el-input v-model="form.target" maxlength="64" show-word-limit />
        </el-form-item>
        <el-form-item v-if="!editing" label="词条类型">
          <el-radio-group v-model="form.kind">
            <el-radio-button value="term">名词</el-radio-button>
            <el-radio-button value="phrase">短句</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-alert
          title="仅保存名词与短句，不保存完整对话、标点或按键符号。修改原文会影响该词条所属原文分组。"
          type="info"
          :closable="false"
        />
      </el-form>
      <template #footer>
        <el-button :disabled="saving" @click="dialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存词条</el-button>
      </template>
    </el-dialog>
  </div>
</template>
