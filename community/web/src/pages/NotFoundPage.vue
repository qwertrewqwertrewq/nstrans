<template>
  <el-result icon="info" title="页面不存在" sub-title="请检查地址，或从导航进入需要的页面。">
    <template #extra>
      <RouterLink to="/"><el-button type="primary">返回首页</el-button></RouterLink>
    </template>
  </el-result>
</template>
