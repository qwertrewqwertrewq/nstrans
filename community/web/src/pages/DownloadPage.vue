<script setup lang="ts">
import { ref } from 'vue'
import PageHeader from '../components/PageHeader.vue'
const support = ref(false)
const platforms = [
  { id: 'macos', name: 'macOS', description: 'Apple Silicon · DMG', note: '本地推理 / 远程翻译' },
  {
    id: 'windows',
    name: 'Windows',
    description: 'Windows 10/11 x64 · NSIS',
    note: 'CPU / Vulkan / CUDA',
  },
  { id: 'ipados', name: 'iPadOS', description: 'arm64 · 未签名 IPA', note: '使用自己的证书自签' },
  {
    id: 'android',
    name: 'Android',
    description: 'arm64 · 调试签名 APK',
    note: '本地推理为实验性功能',
  },
]
const models = [
  {
    id: 'macos',
    title: 'macOS · TranslateGemma 4B',
    format: 'Q4_K_M · Ollama',
    size: '3.30 GB · 与 Windows 共用对象',
  },
  {
    id: 'windows',
    title: 'Windows · TranslateGemma 4B',
    format: 'Q4_K_M · Ollama',
    size: '3.30 GB · 与 macOS 共用对象',
  },
  {
    id: 'ipados',
    title: 'iPadOS · TranslateGemma 4B',
    format: 'IQ4_XS · llama.cpp',
    size: '2.28 GB · 8 GB 设备实测',
  },
  {
    id: 'android',
    title: 'Android · TranslateGemma 4B',
    format: 'Q4_K_M · llama.cpp',
    size: '2.49 GB · 实验性',
  },
  {
    id: 'nllb',
    title: '四平台 · NLLB-200 600M',
    format: 'Q8 · ONNX 单包',
    size: '874 MiB · WithLlama 构建',
  },
]
</script>
<template>
  <div class="page-stack">
    <PageHeader
      eyebrow="DOWNLOAD"
      title="选择平台，开始实时翻译"
      description="镜像自动跟随最新 Release。客户端无需登录社区即可使用公开词库。"
    >
      <a
        href="https://github.com/qwertrewqwertrewq/nstrans/releases/latest"
        target="_blank"
        rel="noreferrer"
      >
        <el-button>查看最新 Release ↗</el-button>
      </a>
    </PageHeader>
    <el-alert title="选择适合的构建" type="info" :closable="false" show-icon>
      <p>
        RemoteOnly 体积更小，支持远程模型与在线机器翻译。WithLlama
        包含本地推理运行时；模型权重仍需首次启动后下载或导入。
      </p>
    </el-alert>
    <div class="grid-two">
      <el-card v-for="platform in platforms" :key="platform.id" shadow="never">
        <template #header>
          <div class="section-title">
            <h2>{{ platform.name }}</h2>
            <el-tag>客户端</el-tag>
          </div>
        </template>
        <p>{{ platform.description }}</p>
        <p class="muted">{{ platform.note }}</p>
        <div class="button-row">
          <a
            :href="`/download/file/${platform.id}-with-llama`"
            target="_blank"
            rel="noreferrer"
            @click="support = true"
          >
            <el-button type="primary">WithLlama ↓</el-button>
          </a>
          <a
            :href="`/download/file/${platform.id}-remote-only`"
            target="_blank"
            rel="noreferrer"
            @click="support = true"
          >
            <el-button>RemoteOnly ↓</el-button>
          </a>
        </div>
      </el-card>
    </div>
    <el-card shadow="never">
      <div class="split-row">
        <div>
          <h2>NSTrans TV</h2>
          <p>
            Android 电视的 HDMI 与局域网字幕客户端。默认在 App 内显示，也可在授予悬浮窗权限后显示
            App 外字幕。
          </p>
          <p class="muted">App 内无声音；如无法启用悬浮窗权限，请让主机外接音源。</p>
        </div>
        <a href="/download/file/tv" target="_blank" rel="noreferrer" @click="support = true">
          <el-button type="primary">下载 TV APK ↓</el-button>
        </a>
      </div>
    </el-card>
    <section>
      <h2>本地模型镜像</h2>
      <p class="muted">仅 WithLlama 使用本地翻译时需要；RemoteOnly 无需下载。</p>
      <div class="grid-two">
        <el-card v-for="model in models" :key="model.id" shadow="never">
          <h3>{{ model.title }}</h3>
          <p>{{ model.format }}</p>
          <div class="split-row">
            <span class="muted">{{ model.size }}</span>
            <a
              :href="`/download/model/${model.id}`"
              target="_blank"
              rel="noreferrer"
              @click="support = true"
            >
              <el-button>下载模型 ↓</el-button>
            </a>
          </div>
        </el-card>
      </div>
    </section>
    <el-card shadow="never">
      <h3>模型来源与许可</h3>
      <div class="link-list">
        <a href="https://ollama.com/library/translategemma:4b" target="_blank" rel="noreferrer">
          macOS / Windows · Ollama Library ↗
        </a>
        <a
          href="https://huggingface.co/mradermacher/translategemma-4b-it-GGUF"
          target="_blank"
          rel="noreferrer"
        >
          iPadOS · mradermacher GGUF ↗
        </a>
        <a
          href="https://huggingface.co/Qwe1325/translategemma-4b-it-GGUF"
          target="_blank"
          rel="noreferrer"
        >
          Android · Qwe1325 GGUF ↗
        </a>
        <a
          href="https://huggingface.co/Xenova/nllb-200-distilled-600M"
          target="_blank"
          rel="noreferrer"
        >
          NLLB · Q8 ONNX ↗
        </a>
      </div>
      <p>
        TranslateGemma 受
        <a href="https://ai.google.dev/gemma/terms" target="_blank" rel="noreferrer">
          Gemma Terms of Use
        </a>
        约束。NLLB-200 600M 及其兼容 ONNX 转换采用 CC BY-NC 4.0，不适用于商业用途。模型不适用
        NSTrans 的 Apache-2.0 许可。
      </p>
      <a href="/download/model-notice" target="_blank" rel="noreferrer" @click="support = true">
        <el-button text type="primary">下载模型 NOTICE.txt ↓</el-button>
      </a>
    </el-card>
    <el-alert title="安装前须知" type="warning" :closable="false" show-icon>
      <p>
        macOS 构建未做 Developer ID 公证；iPadOS 需要自签；Android 使用调试签名。核心客户端安装包在
        GitHub Release 中提供同名 .sha256 文件供校验。
      </p>
    </el-alert>
    <el-dialog v-model="support" title="感谢支持 NSTrans" width="min(480px, 92vw)" align-center>
      <p>如果觉得此项目不错的话，请到GitHub仓库点颗Star！也可捐赠来支持本项目</p>
      <div class="button-row support-actions">
        <a href="https://github.com/qwertrewqwertrewq/nstrans" target="_blank" rel="noreferrer">
          <el-button type="primary">GitHub · 点颗 Star ↗</el-button>
        </a>
        <RouterLink to="/donate" @click="support = false">
          <el-button>支持项目 →</el-button>
        </RouterLink>
      </div>
      <p class="muted">下载已在新标签页开始，支持完全自愿。</p>
    </el-dialog>
  </div>
</template>
