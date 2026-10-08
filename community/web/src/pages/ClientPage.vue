<script setup lang="ts">
import PageHeader from '../components/PageHeader.vue'
</script>
<template>
  <PageHeader
    eyebrow="CLIENT GUIDE"
    title="下载无需登录，登录即可参与共建。"
    description="官方客户端自动同步所选游戏词库。参与共享时在客户端注册、登录或通过 GitHub 授权，凭据会自动保存，无需手动复制 Key。"
  />
  <section class="two-column">
    <el-card shadow="never">
      <h2>三步接入</h2>
      <el-timeline>
        <el-timeline-item timestamp="01 · 选择游戏" placement="top">
          <p>客户端自动下载通用词库与当前游戏的最新词库包。</p>
        </el-timeline-item>
        <el-timeline-item timestamp="02 · 登录并选择共享" placement="top">
          <p>
            在设置向导或密钥管理中登录，再主动开启词库共享。登录本身不会自动开启上传，也可用于访问“wiki镜像”。
          </p>
        </el-timeline-item>
        <el-timeline-item timestamp="03 · 后台提交" placement="top">
          <p>
            搜索确认的专名与符合条件的菜单短标签进入上传队列，完整对白和描述文本不进入社区词库。
          </p>
        </el-timeline-item>
      </el-timeline>
      <RouterLink to="/download"><el-button type="primary">下载客户端</el-button></RouterLink>
    </el-card>
    <el-card shadow="never">
      <h2>读取与共享接口</h2>
      <p>公开词库无需身份验证，返回每个词条当前评分最高的译文。</p>
      <pre>GET /api/v1/dictionaries/{gameId}</pre>
      <p>贡献上传需要客户端密钥认证：</p>
      <pre>
Authorization: Bearer nst_live_••••
POST /api/v1/contributions</pre>
      <RouterLink to="/dashboard/keys">
        <el-button>管理密钥与查看完整 API 文档</el-button>
      </RouterLink>
    </el-card>
  </section>
  <el-alert
    class="section-space"
    title="共享与远程模型是不同设置"
    type="info"
    :closable="false"
    show-icon
  >
    <p>
      启用远程翻译会发送待翻译文字；启用远程视觉识别会发送对应区域截图。请按需启用。发行包不包含游戏画面、剧情文本或模型权重，公开资料和模型遵循各自授权。
    </p>
  </el-alert>
</template>
