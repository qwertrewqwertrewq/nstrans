<script setup lang="ts">
import { computed, ref } from 'vue'
type Model = {id:string;model?:string;platform?:string}
const props=defineProps<{modelValue:string[];models:Model[];label:string}>()
const emit=defineEmits<{ 'update:modelValue':[value:string[]] }>()
const selected=computed({get:()=>props.modelValue,set:value=>emit('update:modelValue',value)})
const dragging=ref<string>()
const names:Record<string,string>={google:'Gemini',bailian:'阿里百炼',deepseek:'DeepSeek'}
function name(id:string) { const model=props.models.find(m=>m.id===id); return model?`${names[model.platform || 'google']} · ${model.model || model.id}`:id }
function move(id:string, target:number) {
  const queue=[...props.modelValue], from=queue.indexOf(id)
  if (from<0 || target<0 || target>=queue.length) return
  queue.splice(from,1);queue.splice(target,0,id);emit('update:modelValue',queue)
}
function drop(index:number) { if (dragging.value) move(dragging.value,index); dragging.value=undefined }
function start(event:DragEvent,id:string) { dragging.value=id; if(event.dataTransfer) { event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',id) } }
</script>
<template>
  <div class="relay-route-queue">
    <el-select v-model="selected" multiple filterable collapse-tags collapse-tags-tooltip :multiple-limit="5" placeholder="选择模型（最多 5 个）" :aria-label="`${label}模型队列`">
      <el-option v-for="model in models" :key="model.id" :label="name(model.id)" :value="model.id" />
    </el-select>
    <ol v-if="modelValue.length" class="queue-list" :aria-label="`${label}优先级`">
      <li v-for="(id,index) in modelValue" :key="id" draggable="true" @dragstart="start($event,id)" @dragend="dragging=undefined" @dragover.prevent @drop.prevent="drop(index)">
        <span class="drag-handle" aria-hidden="true">⠿</span><span class="queue-number">{{ index+1 }}</span>
        <span class="queue-name">{{ name(id) }}<small>{{ index===0?'首选':'故障转移' }}</small></span>
        <el-button text :disabled="index===0" :aria-label="`${label}上移 ${name(id)}`" @click="move(id,index-1)">↑</el-button>
        <el-button text :disabled="index===modelValue.length-1" :aria-label="`${label}下移 ${name(id)}`" @click="move(id,index+1)">↓</el-button>
        <el-button text type="danger" :aria-label="`${label}移除 ${name(id)}`" @click="selected=modelValue.filter(value=>value!==id)">×</el-button>
      </li>
    </ol>
  </div>
</template>
<style scoped>
.relay-route-queue{width:100%;min-width:0}.queue-list{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:8px}.queue-list li{display:flex;align-items:center;gap:8px;padding:10px;border:1px solid var(--el-border-color);border-radius:8px;background:var(--el-fill-color-light)}.drag-handle{cursor:grab;font-size:24px;color:var(--el-text-color-secondary)}.queue-number{font-weight:600}.queue-name{flex:1;min-width:0;overflow-wrap:anywhere;line-height:1.5}.queue-name small{display:block;color:var(--el-text-color-secondary)}.queue-list .el-button{margin:0;padding:8px}@media(max-width:480px){.queue-list li{gap:4px;padding:6px}.queue-list .el-button{padding:6px}}
</style>
