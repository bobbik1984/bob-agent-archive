<template>
  <section class="remote-work-shell" :class="{ 'is-compact': compact, 'drawer-open': drawerOpen }" :aria-label="t('remote_agent.title')">
    <!-- Mobile backdrop overlay for the Hamburger Drawer -->
    <div v-if="compact && drawerOpen" class="work-drawer-backdrop" @click="drawerOpen = false"></div>

    <!-- Left Navigation Drawer (Hamburger Sidebar on Mobile / Collapsible Rail on Desktop) -->
    <aside class="work-drawer" :class="{ open: drawerOpen }" :aria-label="t('remote_agent.sessions')">
      <div class="drawer-section node-switcher-card">
        <div class="drawer-section-header">
          <span class="drawer-kicker">{{ t('remote_agent.node_label') }}</span>
          <div class="drawer-header-actions">
            <button type="button" class="icon-btn" :title="t('remote_agent.manage')" :aria-label="t('remote_agent.manage')" @click="handleOpenConnections">
              <Settings2 :size="15" />
              <span>{{ t('remote_agent.manage') }}</span>
            </button>
            <button v-if="compact" type="button" class="icon-btn" :title="t('remote_agent.close_drawer')" :aria-label="t('remote_agent.close_drawer')" @click="drawerOpen = false">
              <X :size="16" />
            </button>
          </div>
        </div>

        <div class="node-select-row">
          <select
            v-if="state.profiles.length"
            :value="state.selectedProfileId"
            :aria-label="t('remote_agent.connections')"
            :disabled="state.busy"
            @change="controller.connectProfile($event.target.value)"
          >
            <option value="" disabled>{{ t('remote_agent.choose_connection') }}</option>
            <option v-for="p in state.profiles" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
          <button v-else type="button" class="full-btn" @click="handleOpenConnections">
            <Settings2 :size="15" />
            <span>{{ t('remote_agent.add_connection') }}</span>
          </button>
        </div>

        <div v-if="state.connection" class="node-meta-bar">
          <span class="node-endpoint" :title="state.connection.endpoint">
            <span class="status-dot online"></span>
            {{ state.connection.endpoint }}
          </span>
          <div class="node-mini-actions">
            <button type="button" class="mini-btn" :disabled="state.busy" :title="t('remote_agent.refresh')" @click="controller.refresh()">
              <RefreshCw :size="13" />
              <span>{{ t('remote_agent.refresh') }}</span>
            </button>
            <button type="button" class="mini-btn" :title="t('remote_agent.disconnect')" @click="controller.disconnect()">
              <Unplug :size="13" />
              <span>{{ t('remote_agent.disconnect') }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Workspace & Session Search Filter -->
      <div v-if="state.connection" class="drawer-section filter-section">
        <label class="workspace-filter-label">
          <FolderGit2 :size="14" />
          <select v-model="workspaceId" :aria-label="t('remote_agent.project')">
            <option value="">{{ t('remote_agent.all_sessions') }}</option>
            <option v-for="project in state.catalog?.workspaces || []" :key="project.workspaceId" :value="project.workspaceId">
              {{ project.title }}
            </option>
          </select>
        </label>
        <div class="session-search-box">
          <Search :size="14" />
          <input v-model.trim="sessionSearch" type="search" :placeholder="t('remote_agent.search_sessions')" />
          <button v-if="sessionSearch" type="button" class="clear-btn" @click="sessionSearch = ''">
            <X :size="12" />
          </button>
        </div>
      </div>

      <!-- Conversation-style Session List -->
      <div class="drawer-sessions-scroll">
        <template v-if="state.connection">
          <button
            v-for="session in filteredSessions"
            :key="session.sessionId"
            type="button"
            class="session-card"
            :class="{ active: state.sessionId === session.sessionId }"
            :aria-pressed="state.sessionId === session.sessionId"
            @click="selectSession(session.sessionId)"
          >
            <div class="session-card-top">
              <span class="session-card-title">{{ formatSessionTitle(session) }}</span>
              <span v-if="session.running" class="session-running-pill">{{ t('remote_agent.running') }}</span>
              <span v-else-if="session.updatedAt" class="session-time">{{ formatSessionTime(session.updatedAt) }}</span>
            </div>
            <div class="session-card-sub">
              <code>{{ session.sessionId.slice(0, 18) }}</code>
            </div>
          </button>
          <p v-if="!filteredSessions.length" class="remote-hint empty-list-hint">{{ t('remote_agent.empty') }}</p>
        </template>
        <div v-else class="drawer-disconnected-hint">
          <p class="remote-hint">{{ t(state.unlocked ? 'remote_agent.choose_connection' : 'remote_agent.unlock_in_settings') }}</p>
        </div>
      </div>
    </aside>

    <!-- Main Chat-Like Fullscreen Workspace -->
    <div class="work-main-stage">
      <!-- Top Header Bar (matches ChatView mobile-header) -->
      <header class="work-topbar">
        <button
          type="button"
          class="topbar-hamburger"
          :title="drawerOpen ? t('remote_agent.close_drawer') : t('remote_agent.open_drawer')"
          :aria-label="drawerOpen ? t('remote_agent.close_drawer') : t('remote_agent.open_drawer')"
          @click="drawerOpen = !drawerOpen"
        >
          <Menu v-if="compact" :size="20" />
          <PanelLeft v-else :size="18" />
        </button>

        <div class="topbar-center" @click="compact && (drawerOpen = true)">
          <strong class="topbar-title">{{ activeSessionTitle }}</strong>
          <div class="topbar-subtitle">
            <span class="status-dot" :class="connectionStatusClass"></span>
            <span>{{ activeNodeLabel }}</span>
            <template v-if="state.live?.phase">
              <span>·</span>
              <span>{{ t(`remote_agent.phase_${state.live.phase}`) }}</span>
            </template>
          </div>
        </div>

        <div class="topbar-actions">
          <button
            v-if="state.connection && state.sessionId"
            type="button"
            class="topbar-icon-btn"
            :disabled="state.historyBusy || state.busy"
            :title="t('remote_agent.refresh_history')"
            :aria-label="t('remote_agent.refresh_history')"
            @click="controller.select(state.sessionId)"
          >
            <RefreshCw :size="16" :class="{ spinning: state.historyBusy || state.busy }" />
          </button>
          <button
            type="button"
            class="topbar-icon-btn"
            :title="t('remote_agent.manage')"
            :aria-label="t('remote_agent.manage')"
            @click="handleOpenConnections"
          >
            <Settings2 :size="16" />
          </button>
        </div>
      </header>

      <!-- Error / Status Banner -->
      <div v-if="state.error" class="remote-error-banner" role="alert">
        <span>{{ t(`remote_agent.errors.${knownError}`) }}</span>
        <button v-if="state.selectedProfileId && !state.busy" type="button" @click="controller.connectProfile(state.selectedProfileId)">
          {{ t('remote_agent.retry') }}
        </button>
      </div>

      <!-- Scrollable Conversation Transcript -->
      <section ref="transcriptRef" class="remote-transcript" aria-live="polite">
        <div v-if="!state.connection" class="work-empty-stage">
          <p v-if="state.reconnecting || state.busy" role="status" class="remote-hint">{{ t('remote_agent.connecting') }}</p>
          <template v-else>
            <p class="remote-hint">{{ t(state.unlocked ? 'remote_agent.choose_connection' : 'remote_agent.unlock_in_settings') }}</p>
            <div class="empty-stage-actions">
              <button v-if="state.profiles.length" type="button" @click="drawerOpen = true">
                <PanelLeft :size="16" />
                <span>{{ t('remote_agent.open_drawer') }}</span>
              </button>
              <button type="button" @click="handleOpenConnections">
                <Settings2 :size="16" />
                <span>{{ t('remote_agent.manage') }}</span>
              </button>
            </div>
          </template>
        </div>

        <div v-else-if="state.historyBusy && !displayedMessages.length" class="work-empty-stage">
          <p class="remote-hint">{{ t('remote_agent.loading') }}</p>
        </div>

        <div v-else-if="!state.sessionId || !state.history" class="work-empty-stage">
          <p class="remote-hint">{{ t('remote_agent.choose') }}</p>
          <button type="button" @click="drawerOpen = true">
            <PanelLeft :size="16" />
            <span>{{ t('remote_agent.sessions') }}</span>
          </button>
        </div>

        <template v-else>
          <p v-if="state.history.hasMore" class="transcript-meta-pill">{{ t('remote_agent.recent_only') }}</p>

          <article
            v-for="msg in displayedMessages"
            :key="msg.id"
            class="chat-bubble-row"
            :class="msg.role"
          >
            <div class="chat-bubble" :class="msg.role">
              <!-- Collapsible Reasoning & Tool Pills -->
              <div v-if="msg.reasoning || msg.tools?.length" class="assistant-meta-stack">
                <details v-if="msg.reasoning" class="reasoning-box">
                  <summary>💭 {{ t('remote_agent.reasoning') }}</summary>
                  <div class="reasoning-content">{{ msg.reasoning }}</div>
                </details>

                <details v-if="msg.tools?.length" class="tools-box">
                  <summary>
                    <Wrench :size="13" />
                    <span>{{ t('remote_agent.tools_executed', { count: msg.tools.length }) }}</span>
                  </summary>
                  <ul class="tools-list">
                    <li v-for="(tool, idx) in msg.tools" :key="idx">
                      <code>{{ tool.name }}</code>
                      <span v-if="tool.summary">{{ tool.summary }}</span>
                    </li>
                  </ul>
                </details>
              </div>

              <!-- Sanitized Rich Markdown Body (raw HTML is escaped, never executed) -->
              <div
                v-if="msg.text"
                class="remote-markdown-body"
                v-html="renderSafeRemoteMarkdown(msg.text)"
              ></div>

              <!-- Deliverables / Artifact Cards -->
              <div v-if="msg.extractedArtifacts.length" class="artifacts-section">
                <div class="artifacts-header">
                  <FileCode2 :size="14" />
                  <span>{{ t('remote_agent.artifacts_title', { count: msg.extractedArtifacts.length }) }}</span>
                </div>
                <div class="artifacts-grid">
                  <button
                    v-for="art in msg.extractedArtifacts"
                    :key="art.id"
                    type="button"
                    class="artifact-card"
                    @click="openArtifactPreview(art)"
                  >
                    <div class="artifact-icon-tile" :data-kind="art.kind">
                      <FileSpreadsheet v-if="art.kind === 'csv'" :size="18" />
                      <FileText v-else-if="art.kind === 'markdown'" :size="18" />
                      <FileCode2 v-else :size="18" />
                    </div>
                    <div class="artifact-card-body">
                      <strong class="artifact-name">{{ art.name }}</strong>
                      <small class="artifact-desc">{{ art.description || art.path }}</small>
                    </div>
                    <span class="artifact-action-pill">
                      <Eye :size="13" />
                      <span>{{ t('remote_agent.artifact_preview') }}</span>
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </article>

          <!-- Live Streaming Assistant Reasoning & Draft -->
          <article v-if="state.live?.reasoning || state.live?.draft" class="chat-bubble-row assistant live-stream-row">
            <div class="chat-bubble assistant">
              <header class="bubble-header">
                <small class="bubble-role">{{ t('remote_agent.role_assistant') }}</small>
                <span class="session-running-pill">{{ t('remote_agent.running') }}</span>
              </header>
              <details v-if="state.live?.reasoning" class="reasoning-box" open>
                <summary>💭 {{ t('remote_agent.reasoning') }}</summary>
                <div class="reasoning-content">{{ state.live.reasoning }}</div>
              </details>
              <div
                v-if="state.live?.draft"
                class="remote-markdown-body"
                v-html="renderSafeRemoteMarkdown(state.live.draft)"
              ></div>
            </div>
          </article>

          <p v-if="!displayedMessages.length && !state.live?.draft" class="remote-hint empty-list-hint">
            {{ t('remote_agent.no_text') }}
          </p>
          <p v-if="state.history.omittedRecords" class="transcript-meta-pill">
            {{ t('remote_agent.omitted', { count: state.history.omittedRecords }) }}
          </p>
        </template>
      </section>

      <!-- Sticky Bottom Dock: Pending Approvals/Questions + Input Composer -->
      <footer v-if="state.connection && state.live" class="work-composer-dock">
        <aside v-if="controller.needsReview()" class="remote-review-card">
          <p>{{ t('remote_agent.review_uncertain') }}</p>
          <button type="button" @click="controller.reviewed()">{{ t('remote_agent.reviewed') }}</button>
        </aside>

        <!-- Pending Approvals & Questions Overlay -->
        <div v-if="state.live.interactions?.length" class="interactions-stack">
          <article v-for="item in state.live.interactions" :key="item.eventId" class="interaction-card">
            <template v-if="item.kind === 'approval'">
              <div class="interaction-header">
                <strong>{{ t('remote_agent.approval') }} · <code>{{ item.request.toolName }}</code></strong>
                <small>{{ t(`remote_agent.interaction_${item.status}`) }}</small>
              </div>
              <div class="interaction-reason">{{ item.request.reason }}</div>
              <div class="remote-actions">
                <button type="button" class="primary-btn" :disabled="!canAnswer(item)" @click="controller.answer(item.eventId, 'allowed-once')">
                  {{ t('remote_agent.allow_once') }}
                </button>
                <button type="button" :disabled="!canAnswer(item)" @click="controller.answer(item.eventId, 'rejected')">
                  {{ t('remote_agent.reject') }}
                </button>
              </div>
            </template>
            <form v-else @submit.prevent="answerQuestions(item)">
              <fieldset v-for="q in item.request.questions" :key="q.id" :disabled="!canAnswer(item)">
                <legend>{{ q.question }}</legend>
                <p v-if="q.detail" class="remote-detail">{{ q.detail }}</p>
                <label v-for="option in q.options || []" :key="option.label" class="remote-option">
                  <input type="checkbox" :checked="selected(item, q).includes(option.label)" @change="choose(item, q, option.label, $event.target.checked)" />
                  <span>{{ option.label }}<small v-if="option.description"> — {{ option.description }}</small></span>
                </label>
                <label class="custom-answer-label">
                  <span>{{ t('remote_agent.custom_answer') }}</span>
                  <input :value="answers[`${item.eventId}:${q.id}:text`] || ''" @input="answers[`${item.eventId}:${q.id}:text`] = $event.target.value" />
                </label>
              </fieldset>
              <div class="remote-actions">
                <button type="submit" class="primary-btn" :disabled="!canAnswer(item)">{{ t('remote_agent.submit_answer') }}</button>
                <small>{{ t(`remote_agent.interaction_${item.status}`) }}</small>
              </div>
            </form>
          </article>
        </div>

        <!-- Chat-Style Input Bar (Aligned with Home ChatView) -->
        <form class="input-row" @submit.prevent="send">
          <div class="input-wrapper">
            <button
              v-if="compact"
              type="button"
              class="mobile-plus-btn"
              :title="t('remote_agent.open_drawer')"
              @click="drawerOpen = true"
            >
              <Plus :size="20" />
            </button>
            <textarea
              ref="composerInputRef"
              v-model="message"
              class="chat-input"
              :rows="compact ? 1 : 3"
              maxlength="64000"
              enterkeyhint="send"
              :aria-label="t('remote_agent.message')"
              :placeholder="t('remote_agent.input_placeholder')"
              :disabled="!canSend"
              @keydown="handleComposerKeydown"
              @input="autoResizeTextarea"
            />
            <div v-if="compact" class="mobile-send-btn-wrap">
              <button
                v-if="state.live.phase === 'running'"
                type="button"
                class="action-btn stop-btn"
                :disabled="!state.live.ready || state.actionBusy"
                :title="t('remote_agent.cancel')"
                @click="controller.cancel()"
              >
                <span class="icon-stop"></span>
              </button>
              <button
                v-else
                type="submit"
                class="action-btn send-btn"
                :disabled="!canSend || !message.trim()"
                :title="t('remote_agent.send')"
              >
                <span class="icon-send"></span>
              </button>
            </div>
          </div>

          <div v-if="!compact" class="input-toolbar">
            <button type="button" class="toolbar-item" @click="handleOpenConnections">
              <span class="node-dot" :class="connectionStatusClass"></span>
              <span>{{ activeNodeLabel }}</span>
            </button>
            <button type="button" class="toolbar-item" @click="drawerOpen = !drawerOpen">
              <FolderGit2 :size="12" />
              <span>{{ activeWorkspaceLabel }}</span>
            </button>
            <div class="toolbar-spacer"></div>
            <button
              v-if="state.live.phase === 'running'"
              type="button"
              class="action-btn stop-btn"
              :disabled="!state.live.ready || state.actionBusy"
              :title="t('remote_agent.cancel')"
              @click="controller.cancel()"
            >
              <span class="icon-stop"></span>
            </button>
            <button
              v-else
              type="submit"
              class="action-btn send-btn"
              :disabled="!canSend || !message.trim()"
              :title="t('remote_agent.send')"
            >
              <span class="icon-send"></span>
            </button>
          </div>
        </form>
      </footer>
    </div>

    <!-- In-App Artifact / Deliverable Preview Modal -->
    <div v-if="activeArtifact" class="artifact-modal-backdrop" @click.self="activeArtifact = null">
      <section class="artifact-modal" role="dialog" :aria-label="activeArtifact.name">
        <header class="artifact-modal-header">
          <div class="artifact-modal-title">
            <strong>{{ activeArtifact.name }}</strong>
            <code>{{ activeArtifact.path }}</code>
          </div>
          <div class="artifact-modal-actions">
            <button type="button" @click="copyArtifactText(activeArtifact.path)">
              <Copy :size="14" />
              <span>{{ copiedFlag === 'path' ? t('remote_agent.artifact_copied') : t('remote_agent.artifact_copy_path') }}</span>
            </button>
            <button v-if="activeArtifactContent" type="button" @click="copyArtifactText(activeArtifactContent, 'content')">
              <Copy :size="14" />
              <span>{{ copiedFlag === 'content' ? t('remote_agent.artifact_copied') : t('remote_agent.artifact_copy') }}</span>
            </button>
            <button type="button" class="icon-btn" :aria-label="t('remote_agent.close_drawer')" @click="activeArtifact = null">
              <X :size="16" />
            </button>
          </div>
        </header>

        <div class="artifact-modal-body">
          <p v-if="activeArtifact.description" class="artifact-modal-desc">{{ activeArtifact.description }}</p>

          <!-- CSV Table Preview -->
          <div v-if="activeArtifact.kind === 'csv' && activeCsvTable.headers.length" class="csv-table-wrap">
            <table>
              <thead>
                <tr>
                  <th v-for="(h, i) in activeCsvTable.headers" :key="i">{{ h }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, rIdx) in activeCsvTable.rows" :key="rIdx">
                  <td v-for="(cell, cIdx) in row" :key="cIdx">{{ cell }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Markdown Rich Preview -->
          <div
            v-else-if="activeArtifact.kind === 'markdown' && activeArtifactContent"
            class="remote-markdown-body artifact-rich-body"
            v-html="renderSafeRemoteMarkdown(activeArtifactContent)"
          ></div>

          <!-- Code / Raw Text Preview -->
          <div
            v-else-if="activeArtifactContent"
            class="remote-markdown-body"
            v-html="renderSafeRemoteMarkdown('```' + (activeArtifact.name.split('.').pop() || 'text') + '\n' + activeArtifactContent + '\n```')"
          ></div>

          <!-- Path Summary Fallback when file bytes haven't been loaded -->
          <div v-else class="artifact-path-card">
            <p class="remote-hint">{{ t('remote_agent.artifact_path') }}: <code>{{ activeArtifact.path }}</code></p>
          </div>
        </div>
      </section>
    </div>
  </section>
</template>

<script setup>
import { computed, inject, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  Copy, Eye, FileCode2, FileSpreadsheet, FileText, FolderGit2,
  Menu, PanelLeft, Plus, RefreshCw, Search, Settings2, Unplug, Wrench, X,
} from 'lucide-vue-next';
import { getRemoteAgentService } from '../../work/remote-agent-service.js';
import {
  extractMessageArtifacts,
  formatSessionTime,
  formatSessionTitle,
  parseCsvPreview,
  renderSafeRemoteMarkdown,
} from '../../work/remote-agent-markdown.js';

const { t, te } = useI18n();
const compact = inject('isMobile', ref(false));
const openConnections = inject('openRemoteConnections', () => {});
const drawerOpen = ref(!compact.value);
const workspaceId = ref('');
const sessionSearch = ref('');
const message = ref('');
const answers = reactive({});
const drafts = new Map();
const transcriptRef = ref(null);
const composerInputRef = ref(null);
const activeArtifact = ref(null);
const copiedFlag = ref('');

const controller = getRemoteAgentService(window.appAPI);
const state = controller.state;

function handleOpenConnections() {
  if (compact.value) drawerOpen.value = false;
  openConnections();
}

async function selectSession(sessionId) {
  if (compact.value) drawerOpen.value = false;
  await controller.select(sessionId);
  await nextTick();
  scrollToBottom();
}

function scrollToBottom() {
  const el = transcriptRef.value;
  if (el) el.scrollTop = el.scrollHeight;
}

watch(compact, isMobileNow => {
  drawerOpen.value = !isMobileNow || !state.sessionId;
});

watch(() => state.connection && state.sessionId ? `${state.connection.endpoint}:${state.sessionId}` : '', (key, previous) => {
  if (previous) drafts.set(previous, message.value);
  message.value = key ? (drafts.get(key) || '') : '';
  for (const field of Object.keys(answers)) delete answers[field];
}, { flush: 'sync' });

watch(() => state.live?.watchId, () => {
  for (const field of Object.keys(answers)) delete answers[field];
});

const canSend = computed(() => (
  state.live?.ready && !state.error && !state.actionBusy && !controller.needsReview()
  && ['idle', 'completed', 'stopped', 'blocked', 'failed'].includes(state.live.phase)
));

const canAnswer = item => (
  state.live?.ready && !state.error && !state.actionBusy && !controller.needsReview()
  && item.status === 'pending'
);

const selected = (item, q) => answers[`${item.eventId}:${q.id}`] || [];

function choose(item, q, label, checked) {
  const old = selected(item, q);
  answers[`${item.eventId}:${q.id}`] = checked
    ? (q.multiSelect ? [...new Set([...old, label])] : [label])
    : old.filter(x => x !== label);
}

function autoResizeTextarea() {
  const el = composerInputRef.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}

function resetTextareaHeight() {
  nextTick(() => {
    if (composerInputRef.value) {
      composerInputRef.value.style.height = 'auto';
    }
  });
}

function handleComposerKeydown(event) {
  if ((event.key === 'Enter' || event.keyCode === 13) && !event.shiftKey) {
    if (event.isComposing) return;
    event.preventDefault();
    void send();
  }
}

async function send() {
  if (!canSend.value || !message.value.trim()) return;
  const text = message.value;
  if (await controller.send(text, crypto.randomUUID())) {
    message.value = '';
    resetTextareaHeight();
    await nextTick();
    scrollToBottom();
  }
}

function answerQuestions(item) {
  void controller.answer(item.eventId, {
    answers: item.request.questions.map(q => ({
      id: q.id,
      selected: selected(item, q),
      custom: answers[`${item.eventId}:${q.id}:text`] || '',
    })),
  });
}

const knownError = computed(() => (te(`remote_agent.errors.${state.error}`) ? state.error : 'REMOTE_UNKNOWN'));

const sessions = computed(() => {
  const project = state.catalog?.workspaces.find(item => item.workspaceId === workspaceId.value);
  return (state.catalog?.sessions || []).filter(item => !project || project.sessionIds.includes(item.sessionId));
});

const filteredSessions = computed(() => {
  const q = sessionSearch.value.toLowerCase();
  if (!q) return sessions.value;
  return sessions.value.filter(s => (
    formatSessionTitle(s).toLowerCase().includes(q)
    || String(s.title || '').toLowerCase().includes(q)
    || String(s.sessionId || '').toLowerCase().includes(q)
  ));
});

const activeSession = computed(() => (state.catalog?.sessions || []).find(s => s.sessionId === state.sessionId));
const activeSessionTitle = computed(() => (
  activeSession.value ? formatSessionTitle(activeSession.value) : t('remote_agent.work_title')
));

const activeNodeLabel = computed(() => {
  const prof = state.profiles.find(p => p.id === state.selectedProfileId);
  if (prof?.name) return prof.name;
  if (state.connection?.endpoint) {
    try { return new URL(state.connection.endpoint).host; } catch { return state.connection.endpoint; }
  }
  return t('remote_agent.connections');
});

const activeWorkspaceLabel = computed(() => {
  if (workspaceId.value) {
    const ws = state.catalog?.workspaces.find(w => w.workspaceId === workspaceId.value);
    if (ws) return ws.name || ws.rootPath || ws.workspaceId;
  }
  if (activeSession.value?.cwd) {
    return activeSession.value.cwd.split(/[\\/]/).filter(Boolean).pop() || activeSession.value.cwd;
  }
  return t('remote_agent.all_workspaces');
});

const connectionStatusClass = computed(() => {
  if (!state.connection) return 'offline';
  if (state.live?.phase === 'running' || activeSession.value?.running) return 'running';
  return 'online';
});

const displayedMessages = computed(() => (
  (state.history?.messages || []).map(msg => ({
    ...msg,
    extractedArtifacts: extractMessageArtifacts(msg),
  }))
));

const activeArtifactContent = computed(() => {
  if (!activeArtifact.value) return '';
  if (activeArtifact.value.content) return activeArtifact.value.content;
  const previewStore = window.appAPI?.__artifactPreviews || {};
  return previewStore[activeArtifact.value.path] || previewStore[activeArtifact.value.name] || '';
});

const activeCsvTable = computed(() => parseCsvPreview(activeArtifactContent.value));

function openArtifactPreview(art) {
  activeArtifact.value = art;
  copiedFlag.value = '';
}

async function copyArtifactText(text, kind = 'path') {
  if (!text) return;
  try {
    await navigator.clipboard?.writeText(text);
    copiedFlag.value = kind;
    setTimeout(() => { if (copiedFlag.value === kind) copiedFlag.value = ''; }, 2000);
  } catch {
    // ignore clipboard denial in sandboxed contexts
  }
}

// Restore the selected session's workspace after reconnect; never retain another host's filter.
watch(() => state.connection?.connectionId, () => { workspaceId.value = ''; });
watch(() => state.sessionId, id => {
  const project = state.catalog?.workspaces.find(item => item.sessionIds.includes(id));
  if (project) workspaceId.value = project.workspaceId;
});

const activeDrawer = inject('activeDrawer', ref('work'));
watch(activeDrawer, value => { if (value === 'work' && !state.connection) void controller.resume(); });
onMounted(() => { if (activeDrawer.value === 'work' && !state.connection) void controller.resume(); });
</script>

<style scoped>
.remote-work-shell {
  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 560px;
  min-width: 0;
  overflow: hidden;
  background: var(--bg-primary);
  color: var(--text-primary);
}

/* ── Left Drawer (Sidebar on Desktop / Hamburger Slide-over on Mobile) ── */
.work-drawer {
  width: 300px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border-color);
  background: var(--bg-secondary);
  transition: transform 0.22s cubic-bezier(0.22, 1, 0.36, 1), width 0.2s ease;
  z-index: 30;
}

.remote-work-shell:not(.is-compact) .work-drawer:not(.open) {
  width: 0;
  border-right: 0;
  overflow: hidden;
}

.remote-work-shell.is-compact .work-drawer {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: min(84vw, 310px);
  transform: translateX(-102%);
  border-right: 1px solid var(--border-color);
}

.remote-work-shell.is-compact .work-drawer.open {
  transform: translateX(0);
}

.work-drawer-backdrop {
  position: absolute;
  inset: 0;
  background: var(--bg-primary);
  opacity: 0.65;
  z-index: 25;
}

.drawer-section {
  padding: 12px 14px;
  border-bottom: 1px solid var(--border-color);
  display: grid;
  gap: 8px;
}

.drawer-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.drawer-kicker {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-tertiary);
}

.drawer-header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.node-select-row select,
.workspace-filter-label select {
  width: 100%;
  min-height: 38px;
  padding: 6px 10px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-primary);
  font: inherit;
  font-size: 13px;
}

.node-meta-bar {
  display: grid;
  gap: 6px;
}

.node-endpoint {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.node-mini-actions {
  display: flex;
  gap: 6px;
}

.mini-btn,
.icon-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 30px;
  padding: 4px 9px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-secondary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.mini-btn:hover,
.icon-btn:hover {
  color: var(--text-primary);
  border-color: var(--accent-primary);
}

.workspace-filter-label {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
}

.session-search-box {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  min-height: 36px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-secondary);
}

.session-search-box input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: 13px;
  outline: none;
}

.clear-btn {
  border: 0;
  background: transparent;
  color: var(--text-tertiary);
  padding: 2px;
  cursor: pointer;
}

.drawer-sessions-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 8px 10px 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  scrollbar-gutter: stable;
}

.session-card {
  width: 100%;
  text-align: left;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  cursor: pointer;
  display: grid;
  gap: 4px;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.session-card:hover {
  background: var(--bg-tertiary);
}

.session-card.active {
  background: var(--user-accent, var(--accent-primary));
  color: var(--bg-primary);
}

.session-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.session-card-title {
  font-size: 13.5px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-time {
  font-size: 11px;
  opacity: 0.78;
  flex-shrink: 0;
}

.session-card-sub {
  font-size: 11.5px;
  opacity: 0.72;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-running-pill {
  font-size: 10.5px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--bg-tertiary);
  color: var(--color-success);
  border: 1px solid var(--border-color);
  flex-shrink: 0;
}

/* ── Main Stage (Header + Messages + Composer) ── */
.work-main-stage {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-primary);
}

.work-topbar {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 54px;
  padding: 6px 14px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
  flex-shrink: 0;
}

.topbar-hamburger,
.topbar-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-primary);
  cursor: pointer;
  flex-shrink: 0;
}

.topbar-center {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 2px;
  cursor: pointer;
}

.topbar-title {
  font-size: 14.5px;
  font-weight: 650;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.topbar-subtitle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--text-secondary);
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-tertiary);
  flex-shrink: 0;
}

.status-dot.online { background: var(--color-success); }
.status-dot.running { background: var(--user-accent, var(--accent-primary)); }
.status-dot.offline { background: var(--color-warning); }

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.remote-error-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--color-error);
  color: var(--color-error);
  font-size: 13px;
}

.remote-error-banner button {
  padding: 5px 10px;
  border-radius: 8px;
  border: 1px solid var(--color-error);
  background: var(--bg-primary);
  color: var(--text-primary);
  font: inherit;
  cursor: pointer;
}

/* ── Conversation Transcript ── */
.remote-transcript {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px clamp(16px, 3.5vw, 32px) 28px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  scrollbar-gutter: stable;
}

.work-empty-stage {
  margin: auto;
  max-width: 360px;
  text-align: center;
  display: grid;
  gap: 12px;
  justify-items: center;
  padding: 28px 16px;
}

.empty-stage-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
}

.empty-stage-actions button,
.work-empty-stage > button {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 40px;
  padding: 8px 14px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font: inherit;
  cursor: pointer;
}

.transcript-meta-pill {
  align-self: center;
  font-size: 11.5px;
  color: var(--text-tertiary);
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 999px;
  padding: 4px 12px;
  margin: 0;
}

.chat-bubble-row {
  display: flex;
  width: 100%;
}

.chat-bubble-row.user {
  justify-content: flex-end;
}

.chat-bubble-row.assistant {
  justify-content: flex-start;
}

.chat-bubble {
  min-width: 0;
  color: var(--text-primary);
  display: grid;
  gap: 12px;
}

.chat-bubble.user {
  max-width: min(85%, 640px);
  border-radius: 18px 18px 4px 18px;
  padding: 12px 16px;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.chat-bubble.assistant {
  width: 100%;
  max-width: min(100%, 840px);
  padding: 2px 0;
  background: transparent;
  border: 0;
}

.bubble-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.bubble-role {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
}

/* ── Reasoning & Tools Accordions ── */
.assistant-meta-stack {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.reasoning-box,
.tools-box {
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-secondary);
  padding: 6px 12px;
  font-size: 12.5px;
  width: fit-content;
  max-width: 100%;
}

.reasoning-box[open],
.tools-box[open] {
  width: 100%;
}

.reasoning-box summary,
.tools-box summary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  color: var(--text-secondary);
  font-weight: 500;
  list-style: none;
}

.reasoning-box summary::-webkit-details-marker,
.tools-box summary::-webkit-details-marker {
  display: none;
}

.reasoning-content {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border-color);
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: break-word;
  color: var(--text-secondary);
  line-height: 1.65;
}

.tools-list {
  margin: 8px 0 0;
  padding: 8px 0 0 16px;
  border-top: 1px solid var(--border-color);
  display: grid;
  gap: 6px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.tools-list li {
  word-break: break-all;
}

.tools-list code {
  margin-right: 6px;
  color: var(--user-accent, var(--accent-primary));
}

/* ── Rich Markdown Styling ── */
.remote-markdown-body {
  font-size: 14.5px;
  line-height: 1.75;
  letter-spacing: 0.01em;
  word-break: break-word;
  overflow-wrap: break-word;
  min-width: 0;
}

.remote-markdown-body :deep(p) {
  margin: 0 0 12px;
}

.remote-markdown-body :deep(p:last-child) {
  margin-bottom: 0;
}

.remote-markdown-body :deep(h1),
.remote-markdown-body :deep(h2),
.remote-markdown-body :deep(h3) {
  margin: 16px 0 10px;
  font-size: 15.5px;
  font-weight: 650;
  line-height: 1.4;
}

.remote-markdown-body :deep(ul),
.remote-markdown-body :deep(ol) {
  margin: 8px 0 12px;
  padding-left: 20px;
  display: grid;
  gap: 6px;
}

.remote-markdown-body :deep(li) {
  line-height: 1.65;
}

.remote-markdown-body :deep(table) {
  width: max-content;
  min-width: 100%;
  max-width: 100%;
  border-collapse: collapse;
  margin: 12px 0;
  font-size: 13px;
  line-height: 1.5;
  display: block;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-secondary);
}

.remote-markdown-body :deep(th),
.remote-markdown-body :deep(td) {
  border-bottom: 1px solid var(--border-color);
  border-right: 1px solid var(--border-color);
  padding: 8px 12px;
  text-align: left;
  white-space: nowrap;
  word-break: normal;
  overflow-wrap: normal;
}

.remote-markdown-body :deep(th:last-child),
.remote-markdown-body :deep(td:last-child) {
  border-right: 0;
}

.remote-markdown-body :deep(tbody tr:last-child td) {
  border-bottom: 0;
}

.remote-markdown-body :deep(th) {
  background: var(--bg-tertiary);
  font-weight: 600;
  color: var(--text-secondary);
}

.remote-markdown-body :deep(.remote-code-block) {
  margin: 8px 0;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  overflow: hidden;
  background: var(--bg-primary);
}

.remote-markdown-body :deep(.remote-code-header) {
  padding: 4px 10px;
  font-size: 11px;
  color: var(--text-tertiary);
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border-color);
}

.remote-markdown-body :deep(pre) {
  margin: 0;
  padding: 10px 12px;
  overflow-x: auto;
  font-size: 12.5px;
  line-height: 1.5;
}

.remote-markdown-body :deep(.remote-path-pill) {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 6px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  font-size: 12px;
}

/* ── Deliverables / Artifacts Cards ── */
.artifacts-section {
  margin-top: 4px;
  padding-top: 10px;
  border-top: 1px solid var(--border-color);
  display: grid;
  gap: 8px;
}

.artifacts-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.artifacts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 8px;
}

.artifact-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-primary);
  text-align: left;
  font: inherit;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.artifact-card:hover {
  border-color: var(--user-accent, var(--accent-primary));
  background: var(--bg-tertiary);
}

.artifact-icon-tile {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  color: var(--user-accent, var(--accent-primary));
  flex-shrink: 0;
}

.artifact-card-body {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 2px;
}

.artifact-name {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.artifact-desc {
  font-size: 11px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.artifact-action-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--user-accent, var(--accent-primary));
  flex-shrink: 0;
}

/* ── Bottom Composer Dock (Matched to Home ChatView.vue) ── */
.work-composer-dock {
  flex-shrink: 0;
  position: relative;
  padding: var(--space-4, 16px) var(--space-8, 32px) var(--space-6, 24px);
  background: var(--bg-primary);
  display: grid;
  gap: 8px;
}

.remote-work-shell.is-compact .work-composer-dock {
  padding: 8px 12px 12px;
}

.remote-review-card,
.interactions-stack {
  max-width: 1000px;
  width: 100%;
  margin: 0 auto;
}

.remote-review-card,
.interaction-card {
  padding: 12px;
  border-radius: var(--radius-default, 4px);
  border: 1px solid var(--color-warning);
  background: var(--bg-secondary);
  display: grid;
  gap: 8px;
}

.interaction-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.interaction-reason {
  font-size: 13px;
  color: var(--text-secondary);
}

.remote-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.remote-actions button,
.remote-review-card button {
  min-height: 34px;
  padding: 6px 12px;
  border-radius: var(--radius-default, 4px);
  border: 1px solid var(--border-default);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.remote-actions button.primary-btn {
  border-color: var(--user-accent, var(--accent-primary));
  background: var(--user-accent, var(--accent-primary));
  color: var(--bg-primary);
  font-weight: 600;
}

.input-row {
  display: flex;
  flex-direction: column;
  max-width: 1000px;
  width: 100%;
  margin: 0 auto;
  box-sizing: border-box;
  background: var(--surface-card, var(--bg-secondary));
  border: 1px solid var(--border-subtle, var(--border-color));
  border-radius: var(--radius-default, 4px);
  padding: var(--space-2, 8px) var(--space-3, 12px);
  transition: border-color var(--duration-fast, 0.15s) var(--ease-out, ease-out);
}

.input-row:focus-within {
  border-color: var(--border-default);
}

.input-wrapper {
  position: relative;
  width: 100%;
  box-sizing: border-box;
}

.chat-input {
  width: 100%;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-family: var(--font-sans, inherit);
  font-size: var(--text-base, 14px);
  line-height: var(--leading-normal, 1.5);
  resize: none;
  outline: none;
  padding: var(--space-1, 4px) 0;
  min-height: 56px;
  max-height: 160px;
}

.chat-input::placeholder {
  color: var(--text-tertiary, var(--text-secondary));
}

.input-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  padding-top: var(--space-2, 8px);
}

.toolbar-item {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 6px;
  border: none;
  border-radius: var(--radius-default, 4px);
  background: transparent;
  color: var(--text-tertiary, var(--text-secondary));
  font-size: var(--text-xs, 12px);
  font-family: var(--font-sans, inherit);
  cursor: pointer;
  transition: all var(--duration-fast, 0.15s);
  white-space: nowrap;
  flex-shrink: 0;
}

.toolbar-item:hover {
  color: var(--text-secondary);
  background: var(--surface-glass, var(--bg-tertiary));
}

.toolbar-spacer {
  flex: 1;
}

/* ── 发送/停止按钮（与首页 ChatView 统一方形图标样式） ── */
.action-btn {
  position: relative;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 17px;
  height: 17px;
  padding: 0;
  border-radius: var(--radius-default, 4px);
  border: 1px solid var(--border-default);
  background: transparent;
  cursor: pointer;
  transition: all var(--duration-fast, 0.15s);
}

.action-btn::after {
  content: "";
  position: absolute;
  top: -6px;
  right: -6px;
  bottom: -6px;
  left: -6px;
}

.action-btn:hover:not(:disabled) {
  border-color: var(--text-secondary);
}

.send-btn:disabled,
.stop-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.icon-send {
  display: block;
  width: 0;
  height: 0;
  border-style: solid;
  border-width: 3.5px 0 3.5px 6px;
  border-color: transparent transparent transparent var(--text-primary);
  margin-left: 1px;
}

.send-btn:disabled .icon-send {
  border-left-color: var(--text-tertiary, var(--text-secondary));
}

.icon-stop {
  display: block;
  width: 5px;
  height: 5px;
  border-radius: 0.5px;
  background: var(--color-error);
}

/* ── Mobile Input Alignment (Matched to ChatView.is-mobile) ── */
.mobile-plus-btn {
  position: absolute;
  left: 0;
  top: 2px;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  padding: 0;
  flex-shrink: 0;
  cursor: pointer;
  z-index: 10;
}

.mobile-send-btn-wrap {
  position: absolute;
  right: 0;
  top: 2px;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  z-index: 10;
}

.remote-work-shell.is-compact .input-row {
  position: relative;
  align-items: flex-end;
  padding: 8px 12px;
}

.remote-work-shell.is-compact .input-wrapper {
  padding-left: 36px;
  padding-right: 36px;
}

.remote-work-shell.is-compact .chat-input {
  display: block;
  box-sizing: border-box;
  min-height: 36px;
  line-height: 24px;
  padding: 6px 0;
}

/* ── Artifact Preview Modal (Fullscreen on Mobile, Max-Size Sheet on Desktop) ── */
.artifact-modal-backdrop {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--bg-primary) 82%, transparent);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: stretch;
  justify-content: center;
  padding: 12px;
  z-index: 80;
}

.artifact-modal {
  width: min(100%, 1080px);
  height: 100%;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  border-radius: 14px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-primary);
  overflow: hidden;
}

.artifact-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
  flex-shrink: 0;
}

.artifact-modal-title {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 2px;
}

.artifact-modal-title strong {
  font-size: 13.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.artifact-modal-title code {
  font-size: 11px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.artifact-modal-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.artifact-modal-actions button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 32px;
  padding: 4px 9px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-primary);
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
}

.artifact-modal-body {
  flex: 1;
  min-height: 0;
  padding: 12px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.artifact-modal-desc {
  margin: 0;
  font-size: 12.5px;
  color: var(--text-secondary);
}

.csv-table-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-secondary);
}

.csv-table-wrap table {
  width: max-content;
  min-width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}

.csv-table-wrap th,
.csv-table-wrap td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-color);
  border-right: 1px solid var(--border-color);
  text-align: left;
  white-space: nowrap;
}

.csv-table-wrap th:last-child,
.csv-table-wrap td:last-child {
  border-right: 0;
}

.csv-table-wrap th {
  position: sticky;
  top: 0;
  background: var(--bg-tertiary);
  font-weight: 600;
  z-index: 1;
}

.remote-hint {
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.5;
  margin: 0;
}

.empty-list-hint {
  text-align: center;
  padding: 20px 10px;
}

/* ── Mobile / Compact Full-Screen Optimization ── */
.remote-work-shell.is-compact .work-topbar {
  min-height: 46px;
  padding: 4px 10px;
}

.remote-work-shell.is-compact .remote-transcript {
  padding: 10px 10px 14px;
  gap: 14px;
}

.remote-work-shell.is-compact .chat-bubble.user {
  max-width: 90%;
  padding: 10px 13px;
}

.remote-work-shell.is-compact .artifacts-grid {
  grid-template-columns: 1fr;
}

.remote-work-shell.is-compact .work-composer-dock {
  padding: 6px 8px 8px;
}

.remote-work-shell.is-compact .chat-composer-bar {
  padding: 6px 8px;
}

.remote-work-shell.is-compact .artifact-modal-backdrop {
  padding: 0;
}

.remote-work-shell.is-compact .artifact-modal {
  width: 100%;
  height: 100%;
  border-radius: 0;
  border: 0;
}

.remote-work-shell.is-compact .artifact-modal-body {
  padding: 8px;
}
</style>
