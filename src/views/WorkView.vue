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
  overflow: auto;
  box-sizing: border-box;
  background: var(--bg-primary);
  color: var(--text-primary);
  padding: clamp(16px, 2.5vw, 28px);
  scrollbar-gutter: stable;
}

.work-view.layout-desktop-compact {
  padding: 12px 12px 84px;
}

.work-view.layout-mobile-native {
  padding: 0 0 84px;
}
</style>
