// One application service per bridge, not per component. Credentials stay in Rust.
import { reactive } from 'vue';
import { createRemoteAgentController } from './remote-agent-state.js';
import { parseRemoteAgentQr } from './remote-agent-qr.js';

function endpointOrigin(value) {
  try { return new URL(String(value || '').trim()).origin; }
  catch { return ''; }
}

export function createRemoteAgentService(api) {
  const state = reactive({ connection: null, catalog: null, history: null, live: null,
    sessionId: '', busy: false, error: '', unlocked: false, profiles: [], selectedProfileId: '',
    reconnecting: false, retries: 0, storageBusy: false, migrationRequired: false, pendingQr: null });
  let retryTimer = null, generation = 0, connecting = false, paused = false, disposed = false, healthySince = 0, qrToken = '';
  const transient = new Set(['REMOTE_NETWORK', 'REMOTE_TIMEOUT', 'REMOTE_DISCONNECTED']);
  const safe = e => /^REMOTE_[A-Z_]+$/.test(String(e)) ? String(e) : 'REMOTE_UNKNOWN';
  const profile = () => state.profiles.find(p => p.id === state.selectedProfileId);
  const stopRetry = () => { clearTimeout(retryTimer); retryTimer = null; state.reconnecting = false; };
  function scheduleRetry() {
    if (disposed || paused || connecting || state.actionBusy || retryTimer || !profile()?.autoReconnect || !transient.has(state.error) || state.retries >= 5) return;
    state.reconnecting = true;
    retryTimer = setTimeout(() => {
      retryTimer = null; state.retries++;
      void connectProfile(state.selectedProfileId, true);
    }, Math.min(16000, 1000 * 2 ** state.retries));
  }
  const controller = createRemoteAgentController(api, patch => {
    Object.assign(state, patch);
    // A socket that opens and immediately fails must not reset the retry budget.
    if (state.error || !state.live?.ready) healthySince = 0;
    else if (!healthySince) healthySince = Date.now();
    else if (Date.now() - healthySince >= 30000) state.retries = 0;
    scheduleRetry();
  });
  async function load() {
    try { Object.assign(state, await api.remoteAgentProfiles()); return true; }
    catch (e) { state.error = safe(e); return false; }
  }
  async function connectProfile(id, retry = false) {
    if (connecting || disposed) return false;
    stopRetry(); paused = false;
    if (!retry) state.retries = 0;
    const current = ++generation; connecting = true;
    state.selectedProfileId = id;
    try {
      const ok = await controller.connect(null, () => api.remoteAgentReconnect(id));
      if (current !== generation) return false;
      await load();
      if (ok) {
        const sessionId = profile()?.sessionId;
        if (sessionId && state.catalog?.sessions.some(s => s.sessionId === sessionId)) await controller.select(sessionId);
      }
      return ok;
    } finally { connecting = false; if (current === generation) scheduleRetry(); }
  }
  async function select(id) {
    const current = generation, selectedProfileId = state.selectedProfileId;
    await controller.select(id);
    if (current === generation && state.history?.sessionId === id && selectedProfileId) {
      try { await api.remoteAgentProfileUpdate(selectedProfileId, { sessionId: id }); await load(); }
      catch (e) { state.error = safe(e); }
    }
  }
  async function resume() {
    if (disposed || paused || connecting) return;
    await load();
    if (!state.unlocked) return;
    if (['REMOTE_AUTH', 'REMOTE_PROTOCOL'].includes(state.error)) return;
    if (state.connection && !state.error && state.live?.ready !== false) { await controller.refresh(); scheduleRetry(); return; }
    const target = profile() || state.profiles.find(p => p.autoReconnect);
    // Authentication/protocol failures require an explicit user action, not a retry loop.
    if (target?.autoReconnect && !['REMOTE_AUTH', 'REMOTE_PROTOCOL'].includes(state.error)) await connectProfile(target.id);
  }
  async function disconnect() {
    generation++; paused = true; stopRetry();
    let persistenceError = '';
    if (state.selectedProfileId) {
      try { await api.remoteAgentProfileUpdate(state.selectedProfileId, { autoReconnect: false }); await load(); }
      catch (e) { persistenceError = safe(e); }
    }
    await controller.disconnect();
    if (persistenceError) state.error = persistenceError;
  }
  function hasExistingEndpoint(endpoint) {
    const target = endpointOrigin(endpoint);
    if (!target) return false;
    return state.profiles.some(p => endpointOrigin(p.endpoint) === target);
  }
  function clearQr() {
    qrToken = '';
    state.pendingQr = null;
  }
  const service = {
    state, load, resume, select, connectProfile, refresh: () => controller.refresh(), disconnect,
    stageQr(rawCode) {
      clearQr();
      const parsed = parseRemoteAgentQr(rawCode);
      if (!parsed.ok) {
        state.error = safe(parsed.error);
        return false;
      }
      if (!parsed.supported || parsed.adapter !== 'dsh') {
        state.pendingQr = { v: parsed.v, adapter: parsed.adapter, name: parsed.name, endpoint: parsed.endpoint, supported: false };
        state.error = parsed.adapter === 'bob-core' ? 'REMOTE_BOB_CORE_UNSUPPORTED' : 'REMOTE_UNSUPPORTED_ADAPTER';
        return true;
      }
      qrToken = parsed.token;
      state.pendingQr = { v: parsed.v, adapter: parsed.adapter, name: parsed.name, endpoint: parsed.endpoint, supported: true };
      state.error = '';
      return true;
    },
    cancelQr() {
      clearQr();
      if (state.error === 'REMOTE_BOB_CORE_UNSUPPORTED' || state.error.startsWith('REMOTE_QR_')) {
        state.error = '';
      }
    },
    async confirmQr(legacyPassword) {
      if (!state.pendingQr || connecting || disposed) return false;
      const { adapter, name, endpoint, supported } = state.pendingQr;
      if (!supported || adapter !== 'dsh') {
        qrToken = '';
        state.error = adapter === 'bob-core' ? 'REMOTE_BOB_CORE_UNSUPPORTED' : 'REMOTE_UNSUPPORTED_ADAPTER';
        return false;
      }
      if (!qrToken) {
        clearQr();
        state.error = 'REMOTE_QR_MISSING_PARAM';
        return false;
      }
      if (!state.unlocked) {
        const unlocked = await service.unlock(legacyPassword);
        if (!unlocked) {
          if (state.error !== 'REMOTE_VAULT_MIGRATION_REQUIRED') clearQr();
          return false;
        }
      }
      if (hasExistingEndpoint(endpoint)) {
        clearQr();
        state.error = 'REMOTE_QR_OVERWRITE_BLOCKED';
        return false;
      }
      const token = qrToken;
      clearQr();
      return await service.save({ adapter: 'dsh', endpoint, token }, name);
    },
    async unlock(legacyPassword) {
      if (state.storageBusy) return false;
      state.storageBusy = true;
      try {
        const result = await api.remoteAgentUnlock(legacyPassword);
        if (result?.unlocked !== true || !Array.isArray(result.profiles)) throw 'REMOTE_SYSTEM_AUTH_FAILED';
        Object.assign(state, result); state.migrationRequired = false; state.error = ''; paused = false; return true;
      }
      catch (e) { state.error = safe(e); if (state.error === 'REMOTE_VAULT_MIGRATION_REQUIRED') state.migrationRequired = true; return false; }
      finally { state.storageBusy = false; }
    },
    async save(input, name) {
      if (connecting || disposed) return false;
      const adapter = input?.adapter || 'dsh';
      if (adapter !== 'dsh') {
        state.error = adapter === 'bob-core' ? 'REMOTE_BOB_CORE_UNSUPPORTED' : 'REMOTE_UNSUPPORTED_ADAPTER';
        return false;
      }
      stopRetry(); const current = ++generation; connecting = true; paused = false; state.retries = 0;
      const payload = { adapter, endpoint: input?.endpoint || '', token: input?.token || '' };
      try {
        const ok = await controller.connect(null, () => api.remoteAgentSave(payload, name), { preservePreviousOnError: true });
        if (current !== generation) return false;
        if (ok) state.selectedProfileId = state.connection.profileId;
        await load(); return ok;
      } finally {
        payload.token = '';
        connecting = false;
      }
    },
    async automatic(id, value) {
      try { await api.remoteAgentProfileUpdate(id, { autoReconnect: value }); await load(); if (!value) stopRetry(); }
      catch (e) { state.error = safe(e); }
    },
    async forget(id) {
      generation++; stopRetry(); paused = true;
      try {
        await api.remoteAgentForget(id);
        if (id === state.selectedProfileId) { await controller.disconnect(); state.selectedProfileId = ''; }
        await load();
      } catch (e) { state.error = safe(e); }
    },
    async lock() {
      generation++; paused = true; stopRetry(); clearQr(); await controller.disconnect();
      try { await api.remoteAgentLock(); state.unlocked = false; state.profiles = []; state.selectedProfileId = ''; }
      catch (e) { state.error = safe(e); }
    },
    needsReview() { return !!profile()?.uncertainSessions?.includes(state.sessionId); },
    async reviewed() {
      try { await api.remoteAgentProfileUpdate(state.selectedProfileId, { reviewedSession: state.sessionId }); await load(); }
      catch (e) { state.error = safe(e); }
    },
    async send(text, id) {
      if (service.needsReview()) return false;
      const ok = await controller.send(text, id); await load(); return ok;
    },
    async answer(id, answer) {
      if (service.needsReview()) return false;
      const ok = await controller.answer(id, answer); await load(); return ok;
    },
    cancel: () => controller.cancel(),
    async dispose() { disposed = true; generation++; stopRetry(); clearQr(); await controller.dispose(); },
  };
  return service;
}

const services = new WeakMap();
export function getRemoteAgentService(api) {
  if (!services.has(api)) services.set(api, createRemoteAgentService(api));
  return services.get(api);
}
