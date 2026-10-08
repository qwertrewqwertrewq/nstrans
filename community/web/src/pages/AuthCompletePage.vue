<template>
  <el-result
    icon="success"
    title="授权已完成"
    sub-title="NSTrans 客户端正在自动保存登录凭证。现在可以关闭此页面并返回应用，无需复制任何内容。"
  >
    <template #extra>
      <RouterLink to="/"><el-button>返回社区首页</el-button></RouterLink>
    </template>
  </el-result>
</template>
