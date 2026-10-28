// One application service per bridge, not per component. Credentials stay in Rust.
import { reactive } from 'vue';
import { createRemoteAgentController } from './remote-agent-state.js';
import { parseRemoteAgentQr, normalizeHttpsRootEndpoint } from './remote-agent-qr.js';

function endpointOrigin(value) {
  try { return new URL(String(value || '').trim()).origin; }
  catch { return ''; }
}

export function createRemoteAgentService(api) {
  const state = reactive({ connection: null, catalog: null, history: null, live: null,
    sessionId: '', busy: false, error: '', unlocked: false, profiles: [], selectedProfileId: '',
    reconnecting: false, retries: 0, linkDormant: false, linkSmoothness: 'smooth', lastRttMs: 0,
    storageBusy: false, migrationRequired: false, pendingQr: null,
    pairing: null, pairingIssue: null, pairingBusy: false, coreTasks: null, coreSnapshot: null, coreBusy: false, coreMoreBusy: false });
  let pairingTimer = null, pairingGeneration = 0;
  let coreEpoch = 0;
  function resetCore() { coreEpoch++; state.coreTasks = null; state.coreSnapshot = null; state.coreBusy = false; state.coreMoreBusy = false; }
  let retryTimer = null, generation = 0, connecting = false, paused = false, disposed = false, healthySince = 0, qrToken = '';
  const transient = new Set(['REMOTE_NETWORK', 'REMOTE_TIMEOUT', 'REMOTE_DISCONNECTED']);
  const quiescent = new Set(['idle', 'completed', 'stopped', 'blocked', 'failed']);
  const safe = e => /^REMOTE_[A-Z_]+$/.test(String(e)) ? String(e) : 'REMOTE_UNKNOWN';
  const profile = () => state.profiles.find(p => p.id === state.selectedProfileId);
  const stopRetry = () => { clearTimeout(retryTimer); retryTimer = null; state.reconnecting = false; };
  function canHibernateIdleSession() {
    return Boolean(
      state.connection
      && state.history?.messages?.length > 0
      && quiescent.has(state.live?.phase)
      && (!state.live?.interactions || state.live.interactions.length === 0)
    );
  }
  function scheduleRetry() {
    if (disposed || paused || connecting || state.actionBusy || retryTimer || state.linkDormant || !profile()?.autoReconnect || !transient.has(state.error)) return;
    if (canHibernateIdleSession()) {
      state.linkDormant = true;
      state.linkSmoothness = 'long-haul';
      state.error = '';
      state.reconnecting = false;
      return;
    }
    if (state.retries >= 5) return;
    state.reconnecting = true;
    retryTimer = setTimeout(() => {
      retryTimer = null; state.retries++;
      void connectProfile(state.selectedProfileId, true);
    }, Math.min(16000, 1000 * 2 ** state.retries));
  }
  const controller = createRemoteAgentController(api, patch => {
    if ('connection' in patch && !patch.connection) resetCore();
    Object.assign(state, patch);
    if (patch.linkDormant) {
      stopRetry();
      return;
    }
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
  async function connectProfile(id, retry = false, options = {}) {
    if (connecting || disposed) return false;
    stopRetry(); paused = false;
    if (!retry) state.retries = 0;
    const current = ++generation; connecting = true;
    const preserveView = Boolean(options.preserveView ?? (retry && state.history && state.sessionId && state.selectedProfileId === id));
    const useCachedCatalog = Boolean(options.useCachedCatalog && state.catalog && state.selectedProfileId === id);
    state.selectedProfileId = id;
    const t0 = Date.now();
    try {
      const ok = await controller.connect(null, () => api.remoteAgentReconnect(id), {
        preservePreviousOnError: retry || preserveView,
        preserveView,
        cachedCatalog: useCachedCatalog ? state.catalog : null,
      });
      if (current !== generation) return false;
      const rtt = Date.now() - t0;
      state.lastRttMs = rtt;
      if (rtt > 600 || retry) state.linkSmoothness = 'long-haul';
      await load();
      if (ok && !options.skipAutoSelect) {
        const sessionId = state.sessionId || profile()?.sessionId;
        if (sessionId && state.catalog?.sessions.some(s => s.sessionId === sessionId)) {
          await select(sessionId, { preserveView });
        }
      }
      return ok;
    } finally { connecting = false; if (current === generation) scheduleRetry(); }
  }
  async function select(id, options = {}) {
    if (state.sessionId !== id) resetCore();
    if ((!state.connection || state.live?.ready === false || state.linkDormant) && state.selectedProfileId && !connecting) {
      const ok = await connectProfile(state.selectedProfileId, true, {
        skipAutoSelect: true,
        preserveView: Boolean(state.history?.sessionId === id),
        useCachedCatalog: Boolean(state.catalog),
      });
      if (!ok) return;
    }
    const current = generation, selectedProfileId = state.selectedProfileId;
    await controller.select(id, options);
    if (current === generation && state.history?.sessionId === id && state.connection?.adapter === 'bob-core') await loadCoreTasks();
    if (current === generation && state.history?.sessionId === id && selectedProfileId && profile()?.sessionId !== id) {
      try { await api.remoteAgentProfileUpdate(selectedProfileId, { sessionId: id }); await load(); }
      catch (e) { state.error = safe(e); }
    }
  }
  async function resume() {
    if (disposed || paused || connecting) return;
    if (state.connection && !state.error && state.live?.ready !== false) return;
    await load();
    if (!state.unlocked) return;
    if (['REMOTE_AUTH', 'REMOTE_PROTOCOL'].includes(state.error)) return;
    if (state.connection && !state.error && state.live?.ready !== false) return;
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
  function hasExistingEndpoint(endpoint, adapter = 'dsh') {
    const target = endpointOrigin(endpoint);
    if (!target) return false;
    return state.profiles.some(p => (p.adapter || 'dsh') === adapter && endpointOrigin(p.endpoint) === target);
  }
  function clearQr() {
    qrToken = '';
    state.pendingQr = null;
  }
  async function loadCoreTasks(more = false) {
    if (state.connection?.adapter !== 'bob-core' || !state.sessionId || state.coreBusy) return false;
    const epoch = coreEpoch, connectionId = state.connection.connectionId, projectId = state.sessionId;
    const cursor = more ? state.coreTasks?.nextCursor : null;
    if (more && (!state.coreTasks?.hasMore || !cursor)) return false;
    state.coreBusy = true;
    try {
      const page = await api.remoteAgentCoreTasks(connectionId, projectId, cursor);
      if (epoch !== coreEpoch || disposed) return false;
      if (!Array.isArray(page.items) || page.items.some(x => x.project_id !== projectId) || (page.hasMore && (!page.nextCursor || page.nextCursor === cursor))) throw 'REMOTE_PROTOCOL';
      const old = more ? state.coreTasks.items : [];
      if (page.items.some(x => old.some(y => y.id === x.id))) throw 'REMOTE_PROTOCOL';
      state.coreTasks = { ...page, items: [...old, ...page.items] }; return true;
    } catch (e) { if (epoch === coreEpoch) state.error = safe(e); return false; }
    finally { if (epoch === coreEpoch) state.coreBusy = false; }
  }
  async function cancelPairing() {
    pairingGeneration++;
    clearTimeout(pairingTimer); pairingTimer = null;
    const previous = state.pairing, id = previous?.pairingId;
    state.pairing = null; state.pairingBusy = false;
    if (id) {
      try { await api.remoteAgentCorePairCancel(id); }
      catch (e) { state.error = safe(e); if (state.error === 'REMOTE_PAIRING_REVOKE_REQUIRED') state.pairingIssue = previous; }
    }
  }
  async function pollPairing(epoch) {
    if (epoch !== pairingGeneration || disposed || !state.pairing) return;
    if (Date.now() >= new Date(state.pairing.expiresAt).getTime()) {
      await cancelPairing(); state.error = 'REMOTE_PAIRING_EXPIRED'; return;
    }
    try {
      const result = await api.remoteAgentCorePairPoll(state.pairing.pairingId);
      if (epoch !== pairingGeneration || disposed) return;
      if (result.status === 'connected' && result.connection) {
        const connection = result.connection;
        state.pairing = null;
        const ok = await controller.connect(null, async () => connection, { preservePreviousOnError: true });
        if (epoch !== pairingGeneration || disposed) return;
        if (ok) state.selectedProfileId = connection.profileId;
        await load(); return;
      }
      if (result.status !== 'pending') throw 'REMOTE_PROTOCOL';
      pairingTimer = setTimeout(() => void pollPairing(epoch), Math.max(5000, state.pairing.intervalMs || 5000));
    } catch (e) {
      if (epoch === pairingGeneration) {
        const previous = state.pairing;
        await cancelPairing();
        if (state.error !== 'REMOTE_PAIRING_REVOKE_REQUIRED') state.error = safe(e);
        if (['REMOTE_PAIRING_REVOKE_REQUIRED', 'REMOTE_EXCHANGE_UNKNOWN'].includes(state.error)) state.pairingIssue = previous;
      }
    }
  }
  const service = {
    state, load, resume, select, connectProfile, loadCoreTasks,
    async moreCoreMessages() {
      if (state.connection?.adapter !== 'bob-core' || !state.history?.hasMore || state.coreMoreBusy) return false;
      const epoch = coreEpoch, projectId = state.sessionId, after = state.history.nextAfter;
      state.coreMoreBusy = true;
      try {
        const page = await api.remoteAgentCoreMessages(state.connection.connectionId, projectId, after);
        if (epoch !== coreEpoch || disposed) return false;
        if (page.sessionId !== projectId || !Array.isArray(page.messages) || !Number.isSafeInteger(page.nextAfter) || page.nextAfter < after || (page.hasMore && page.nextAfter === after)) throw 'REMOTE_PROTOCOL';
        if (page.messages.some(x => state.history.messages.some(y => y.id === x.id))) throw 'REMOTE_PROTOCOL';
        state.history = { ...page, messages: [...state.history.messages, ...page.messages] }; return true;
      } catch (e) { if (epoch === coreEpoch) state.error = safe(e); return false; }
      finally { if (epoch === coreEpoch) state.coreMoreBusy = false; }
    },
    async readCoreSnapshot(taskId) {
      if (state.connection?.adapter !== 'bob-core' || !state.coreTasks?.items.some(x => x.id === taskId)) return false;
      const epoch = ++coreEpoch, projectId = state.sessionId;
      state.coreSnapshot = null; state.coreBusy = true; state.coreMoreBusy = false;
      try {
        const snapshot = await api.remoteAgentCoreSnapshot(state.connection.connectionId, taskId);
        if (epoch !== coreEpoch || disposed) return false;
        if (snapshot.task?.id !== taskId || snapshot.task?.project_id !== projectId) throw 'REMOTE_PROTOCOL';
        state.coreSnapshot = snapshot; return true;
      } catch (e) { if (epoch === coreEpoch) state.error = safe(e); return false; }
      finally { if (epoch === coreEpoch) state.coreBusy = false; }
    },
    async refresh() {
      if ((!state.connection || state.live?.ready === false || state.linkDormant) && state.selectedProfileId && !connecting) {
        return await connectProfile(state.selectedProfileId, true, { preserveView: true });
      }
      return await controller.refresh();
    },
    disconnect, cancelPairing,
    async beginPairing(endpoint, name) {
      if (!state.unlocked || disposed || state.pairingBusy) { state.error = 'REMOTE_VAULT_LOCKED'; return false; }
      const normalized = normalizeHttpsRootEndpoint(endpoint);
      if (!normalized.ok) { state.error = normalized.error; return false; }
      await cancelPairing();
      const epoch = pairingGeneration;
      state.pairingBusy = true; state.error = ''; state.pairingIssue = null;
      let pendingId = '';
      try {
        const result = await api.remoteAgentCorePairBegin(normalized.endpoint, name);
        pendingId = result.pairingId;
        if (epoch !== pairingGeneration || disposed) {
          await api.remoteAgentCorePairCancel(result.pairingId); return false;
        }
        const uri = new URL(result.verificationUri);
        if (uri.origin !== normalized.endpoint || uri.pathname !== '/client-connect' || uri.username || uri.password || uri.hash ||
            !Number.isFinite(new Date(result.expiresAt).getTime()) || !result.pairingId || !result.userCode) throw 'REMOTE_PROTOCOL';
        // Whitelist public metadata; never copy credential or verifier fields into Vue state.
        state.pairing = { pairingId: result.pairingId, userCode: result.userCode, verificationUri: uri.href, endpoint: normalized.endpoint, name,
          expiresAt: result.expiresAt, intervalMs: Math.max(5000, result.intervalMs || 5000), challengeFingerprint: result.challengeFingerprint || '' };
        pairingTimer = setTimeout(() => void pollPairing(epoch), state.pairing.intervalMs);
        return true;
      } catch (e) {
        if (pendingId) { try { await api.remoteAgentCorePairCancel(pendingId); } catch {} }
        if (epoch === pairingGeneration) state.error = safe(e); return false;
      }
      finally { if (epoch === pairingGeneration) state.pairingBusy = false; }
    },
    async openPairing() {
      const pairing = state.pairing || state.pairingIssue;
      if (!pairing) return false;
      try { await api.openExternal(pairing.verificationUri); return true; }
      catch (e) { state.error = safe(e); return false; }
    },
    async revoke(id) {
      generation++; paused = true; stopRetry();
      if (state.selectedProfileId === id) await controller.disconnect();
      try {
        await api.remoteAgentCoreRevoke(id);
        if (state.selectedProfileId === id) { await controller.disconnect(); state.selectedProfileId = ''; }
        await load(); return true;
      } catch (e) { await load(); state.error = safe(e); return false; }
    },
    stageQr(rawCode) {
      clearQr();
      const parsed = parseRemoteAgentQr(rawCode);
      if (!parsed.ok) {
        state.error = safe(parsed.error);
        return false;
      }
      if (!parsed.supported) {
        state.pendingQr = { v: parsed.v, adapter: parsed.adapter, name: parsed.name, endpoint: parsed.endpoint, supported: false };
        state.error = parsed.adapter === 'bob-core' ? 'REMOTE_BOB_CORE_UNSUPPORTED' : 'REMOTE_UNSUPPORTED_ADAPTER';
        return true;
      }
      qrToken = parsed.token || '';
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
      if (!supported) {
        qrToken = '';
        state.error = adapter === 'bob-core' ? 'REMOTE_BOB_CORE_UNSUPPORTED' : 'REMOTE_UNSUPPORTED_ADAPTER';
        return false;
      }
      if (adapter === 'dsh' && !qrToken) {
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
      if (hasExistingEndpoint(endpoint, adapter)) {
        clearQr();
        state.error = 'REMOTE_QR_OVERWRITE_BLOCKED';
        return false;
      }
      const token = qrToken;
      clearQr();
      if (adapter === 'bob-core') return await service.beginPairing(endpoint, name);
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
      generation++; paused = true; stopRetry(); clearQr(); await cancelPairing(); await controller.disconnect();
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
      if ((!state.connection || state.live?.ready === false || state.linkDormant) && state.selectedProfileId && !connecting) {
        const currentSession = state.sessionId;
        const restored = await connectProfile(state.selectedProfileId, true, {
          skipAutoSelect: true,
          preserveView: true,
          useCachedCatalog: Boolean(state.catalog),
        });
        if (!restored) return false;
        if (currentSession) await controller.select(currentSession, { preserveView: true });
        if (service.needsReview()) return false;
      }
      const ok = await controller.send(text, id); await load(); return ok;
    },
    async answer(id, answer) {
      if (service.needsReview()) return false;
      const ok = await controller.answer(id, answer); await load(); return ok;
    },
    cancel: () => controller.cancel(),
    async dispose() { disposed = true; generation++; stopRetry(); clearQr(); await cancelPairing(); await controller.dispose(); },
  };
  return service;
}

const services = new WeakMap();
export function getRemoteAgentService(api) {
  if (!services.has(api)) services.set(api, createRemoteAgentService(api));
  return services.get(api);
}
