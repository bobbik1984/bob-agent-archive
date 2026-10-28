<template>
  <section class="work-view" :class="[`layout-${layoutMode}`]">
    <RemoteAgentPanel />
  </section>
</template>

<script setup>
import { defineAsyncComponent, inject, ref } from 'vue';

const RemoteAgentPanel = defineAsyncComponent(() => import('../components/work/RemoteAgentPanel.vue'));
const layoutMode = inject('layoutMode', ref('desktop-wide'));
</script>

<style scoped>
.work-view {
  height: 100%;
  width: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  background: var(--bg-primary);
  color: var(--text-primary);
}
</style>
