<script setup lang="ts">
defineProps<{ error: string }>()
defineEmits<{ retry: [] }>()
</script>
<template>
  <el-alert v-if="error" type="error" :closable="false" show-icon class="load-error">
    <template #title>{{ error }}</template>
    <el-button size="small" @click="$emit('retry')">重新加载</el-button>
  </el-alert>
</template>
