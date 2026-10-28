import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRemoteAgentService, getRemoteAgentService } from './remote-agent-service.js';
const live = () => ({ watchId: 'w1', sessionId: 's1', phase: 'idle', ready: true, messages: [], interactions: [] });
function fixture() {
  let unlocked = true;
  let profiles = [{ id: 'p1', name: 'Test', endpoint: 'https://test.invalid/', sessionId: 's1', autoReconnect: true, uncertainSessions: [] }];
  const api = {
    remoteAgentProfiles: vi.fn(async () => ({ unlocked, profiles: structuredClone(profiles) })),
    remoteAgentUnlock: vi.fn(async () => { unlocked = true; return { unlocked, profiles: structuredClone(profiles) }; }),
    remoteAgentLock: vi.fn(async () => { unlocked = false; }),
    remoteAgentReconnect: vi.fn(async () => ({ connectionId: 'c1', profileId: 'p1', capabilities: { catalog: true, history: true, send: true } })),
    remoteAgentCatalog: vi.fn(async () => ({ workspaces: [], sessions: [{ sessionId: 's1' }] })),
    remoteAgentWatch: vi.fn(async () => live()), remoteAgentLive: vi.fn(async () => live()),
    remoteAgentAction: vi.fn(async () => live()), remoteAgentDisconnect: vi.fn(async () => {}),
    remoteAgentProfileUpdate: vi.fn(async (id, patch) => { const p = profiles.find(p => p.id === id); Object.assign(p, patch); if (patch.reviewedSession) p.uncertainSessions = []; }),
    remoteAgentForget: vi.fn(async id => { profiles = profiles.filter(p => p.id !== id); }),
  };
  return { api, profiles, service: createRemoteAgentService(api) };
}
afterEach(() => vi.useRealTimers());
describe('saved connections and safe reconnect', () => {
  it('loads Core pages and pinned task facts, rejecting mismatched snapshots', async () => {
    const { api, service } = fixture();
    api.remoteAgentReconnect.mockResolvedValue({ connectionId: 'core', profileId: 'p1', adapter: 'bob-core', capabilities: { catalog: true, history: true, send: false } });
    api.remoteAgentCoreMessages = vi.fn(async (_, sessionId, after) => ({ sessionId, messages: [{ id: after ? 'm2' : 'm1', role: 'assistant', text: 'fact' }], hasMore: !after, nextAfter: after ? 2 : 1 }));
    api.remoteAgentCoreTasks = vi.fn(async (_, projectId) => ({ items: [{ id: 't1', project_id: projectId }], hasMore: false, nextCursor: null }));
    api.remoteAgentCoreSnapshot = vi.fn(async () => ({ task: { id: 't1', project_id: 's1' }, executions: [], verifications: [], observedAt: 1 }));
    await service.resume(); await service.select('s1');
    expect(await service.moreCoreMessages()).toBe(true); expect(service.state.history.messages.map(x=>x.id)).toEqual(['m1','m2']);
    expect(await service.readCoreSnapshot('t1')).toBe(true); expect(service.state.coreSnapshot.task.id).toBe('t1');
    api.remoteAgentCoreSnapshot.mockResolvedValue({ task: { id: 't1', project_id: 'other' } });
    expect(await service.readCoreSnapshot('t1')).toBe(false); expect(service.state.coreSnapshot).toBeNull(); expect(service.state.error).toBe('REMOTE_PROTOCOL');
    await service.dispose();
  });
  it('failed revocation stops automatic resume rather than silently reusing the credential', async () => {
    const { api, service } = fixture(); await service.resume();
    api.remoteAgentCoreRevoke = vi.fn().mockRejectedValue('REMOTE_PAIRING_REVOKE_REQUIRED');
    expect(await service.revoke('p1')).toBe(false); await service.resume();
    expect(api.remoteAgentReconnect).toHaveBeenCalledTimes(1); expect(service.state.connection).toBeNull(); expect(service.state.profiles).toHaveLength(1);
    await service.dispose();
  });
  it('stops pairing at the absolute deadline and keeps a failed revocation visible', async () => {
    vi.useFakeTimers(); const { api, service } = fixture(); await service.unlock();
    api.remoteAgentCorePairBegin = vi.fn(async () => ({ pairingId: 'pair', userCode: '123456789A', verificationUri: 'https://core.invalid/client-connect', expiresAt: Date.now() + 5000, intervalMs: 5000 }));
    api.remoteAgentCorePairPoll = vi.fn(); api.remoteAgentCorePairCancel = vi.fn();
    await service.beginPairing('https://core.invalid', 'Core'); await vi.advanceTimersByTimeAsync(5000);
    expect(api.remoteAgentCorePairPoll).not.toHaveBeenCalled(); expect(service.state.error).toBe('REMOTE_PAIRING_EXPIRED');
    expect(service.state.pairing).toBeNull(); api.remoteAgentCoreRevoke = vi.fn().mockRejectedValue('REMOTE_NETWORK');
    expect(await service.revoke('p1')).toBe(false); expect(service.state.profiles).toHaveLength(1); expect(service.state.error).toBe('REMOTE_NETWORK');
    await service.dispose();
  });
  it('does not retry a lost exchange reply or claim it was connected', async () => {
    vi.useFakeTimers(); const { api, service } = fixture(); await service.unlock();
    api.remoteAgentCorePairBegin = vi.fn(async () => ({ pairingId: 'pair', userCode: '123456789A', verificationUri: 'https://core.invalid/client-connect', expiresAt: Date.now()+600000, intervalMs: 5000 }));
    api.remoteAgentCorePairPoll = vi.fn().mockRejectedValue('REMOTE_EXCHANGE_UNKNOWN'); api.remoteAgentCorePairCancel = vi.fn();
    await service.beginPairing('https://core.invalid', 'Core'); await vi.advanceTimersByTimeAsync(90000);
    expect(api.remoteAgentCorePairPoll).toHaveBeenCalledTimes(1); expect(service.state.connection).toBeNull();
    expect(service.state.error).toBe('REMOTE_EXCHANGE_UNKNOWN'); await service.dispose();
  });
  it('pairs Core without transferring credentials to Vue or enabling task actions', async () => {
    vi.useFakeTimers(); const { api, service } = fixture(); await service.unlock();
    api.remoteAgentCorePairBegin = vi.fn(async () => ({ pairingId: 'pair', userCode: '123456789A', verificationUri: 'https://core.invalid/client-connect?user_code=123456789A', expiresAt: new Date(Date.now() + 600000).toISOString(), intervalMs: 5000, verifier: 'must-not-leak' }));
    api.remoteAgentCorePairPoll = vi.fn().mockResolvedValueOnce({ status: 'pending' }).mockResolvedValueOnce({ status: 'connected', connection: { connectionId: 'core', profileId: 'pc', adapter: 'bob-core', capabilities: { catalog: true, history: true, send: false } } });
    api.remoteAgentCorePairCancel = vi.fn(); api.openExternal = vi.fn();
    const qr = 'bob://remote-agent?v=2&adapter=bob-core&name=Core&endpoint=https%3A%2F%2Fcore.invalid';
    expect(service.stageQr(qr)).toBe(true); expect(await service.confirmQr()).toBe(true);
    expect(JSON.stringify(service.state)).not.toContain('must-not-leak');
    await service.openPairing(); expect(api.openExternal).toHaveBeenCalledWith('https://core.invalid/client-connect?user_code=123456789A');
    await vi.advanceTimersByTimeAsync(10000); expect(service.state.connection.adapter).toBe('bob-core');
    expect(service.state.pairing).toBeNull(); expect(await service.send('no', 'r')).toBe(false);
    expect(api.remoteAgentAction).not.toHaveBeenCalled(); await service.dispose();
  });
  it('cancels Core polling on lock and ignores late native responses', async () => {
    vi.useFakeTimers(); const { api, service } = fixture(); await service.unlock(); let resolve;
    api.remoteAgentCorePairBegin = vi.fn(async () => ({ pairingId: 'pair', userCode: '123456789A', verificationUri: 'https://core.invalid/client-connect', expiresAt: new Date(Date.now() + 600000).toISOString(), intervalMs: 5000 }));
    api.remoteAgentCorePairPoll = vi.fn(() => new Promise(r => { resolve = r; })); api.remoteAgentCorePairCancel = vi.fn();
    await service.beginPairing('https://core.invalid', 'Core'); await vi.advanceTimersByTimeAsync(5000);
    await service.lock(); resolve({ status: 'connected', connection: { connectionId: 'late', capabilities: { catalog: true } } });
    await vi.advanceTimersByTimeAsync(60000); expect(service.state.connection).toBeNull(); expect(service.state.pairing).toBeNull();
    expect(api.remoteAgentCorePairPoll).toHaveBeenCalledTimes(1); expect(api.remoteAgentCorePairCancel).toHaveBeenCalledWith('pair'); await service.dispose();
  });
  it('rejects foreign authorization pages and never opens them', async () => {
    const { api, service } = fixture(); await service.unlock();
    api.remoteAgentCorePairBegin = vi.fn(async () => ({ pairingId: 'pair', userCode: '123456789A', verificationUri: 'https://evil.invalid/client-connect', expiresAt: new Date(Date.now()+600000).toISOString() }));
    api.openExternal = vi.fn();
    expect(await service.beginPairing('https://core.invalid', 'Core')).toBe(false); expect(service.state.error).toBe('REMOTE_PROTOCOL');
    await service.openPairing(); expect(api.openExternal).not.toHaveBeenCalled(); await service.dispose();
  });
  it('unlocks with the native system without a Bob password', async () => {
    const { api, service } = fixture();
    expect(await service.unlock()).toBe(true);
    expect(api.remoteAgentUnlock).toHaveBeenCalledWith(undefined);
    expect(service.state.unlocked).toBe(true);
    expect(api.remoteAgentAction).not.toHaveBeenCalled();
    await service.dispose();
  });
  it('preserves locked state on cancellation and invalid native responses', async () => {
    for (const response of [null, {}, { unlocked: false, profiles: [] }, { unlocked: true }]) {
      const { api, service } = fixture(); api.remoteAgentUnlock.mockResolvedValue(response);
      expect(await service.unlock()).toBe(false); expect(service.state.unlocked).toBe(false);
      expect(service.state.storageBusy).toBe(false); expect(api.remoteAgentReconnect).not.toHaveBeenCalled();
      await service.dispose();
    }
    const { api, service } = fixture(); api.remoteAgentUnlock.mockRejectedValue('REMOTE_SYSTEM_AUTH_CANCELLED');
    expect(await service.unlock()).toBe(false); expect(service.state.unlocked).toBe(false);
    expect(service.state.error).toBe('REMOTE_SYSTEM_AUTH_CANCELLED'); await service.dispose();
  });
  it('offers legacy migration only when native storage requests it', async () => {
    const { api, service } = fixture();
    api.remoteAgentUnlock.mockRejectedValueOnce('REMOTE_VAULT_MIGRATION_REQUIRED');
    expect(await service.unlock()).toBe(false); expect(service.state.migrationRequired).toBe(true);
    expect(await service.unlock('one-time-old-password')).toBe(true);
    expect(service.state.migrationRequired).toBe(false);
    expect(JSON.stringify(service.state)).not.toContain('one-time-old-password');
    await service.dispose();
  });
  it('is lazy and shares a single application lifetime', async () => {
    const { api, service } = fixture(); expect(api.remoteAgentProfiles).not.toHaveBeenCalled();
    expect(getRemoteAgentService(api)).toBe(getRemoteAgentService(api));
    await service.resume(); expect(service.state.sessionId).toBe('s1');
    await service.resume(); expect(api.remoteAgentReconnect).toHaveBeenCalledTimes(1); expect(api.remoteAgentCatalog).toHaveBeenCalledTimes(1);
    await service.refresh(); expect(api.remoteAgentCatalog).toHaveBeenCalledTimes(2);
    await service.dispose();
  });
  it('does not connect while locked or replay an execution', async () => {
    const { api, service } = fixture(); api.remoteAgentProfiles.mockResolvedValue({ unlocked: false, profiles: [] });
    await service.resume(); expect(api.remoteAgentReconnect).not.toHaveBeenCalled(); expect(api.remoteAgentAction).not.toHaveBeenCalled(); await service.dispose();
  });
  it('restores sessions after bounded retry, never resending a prompt', async () => {
    vi.useFakeTimers(); const { api, service } = fixture(); await service.resume();
    api.remoteAgentLive.mockRejectedValueOnce('REMOTE_DISCONNECTED');
    await vi.advanceTimersByTimeAsync(250); expect(service.state.reconnecting).toBe(true);
    await vi.advanceTimersByTimeAsync(1000); expect(api.remoteAgentReconnect).toHaveBeenCalledTimes(2);
    expect(api.remoteAgentAction).not.toHaveBeenCalled(); expect(service.state.sessionId).toBe('s1'); await service.dispose();
  });
  it('stops retries for expired authentication and protocol failures', async () => {
    vi.useFakeTimers();
    for (const error of ['REMOTE_AUTH', 'REMOTE_PROTOCOL']) {
      const { api, service } = fixture(); api.remoteAgentReconnect.mockRejectedValue(error);
      await service.resume(); await vi.advanceTimersByTimeAsync(60000); await service.resume();
      expect(api.remoteAgentReconnect).toHaveBeenCalledTimes(1); expect(service.state.error).toBe(error); await service.dispose();
    }
  });
  it('exhausts network retries and preserves saved connections', async () => {
    vi.useFakeTimers(); const { api, service } = fixture(); api.remoteAgentReconnect.mockRejectedValue('REMOTE_NETWORK');
    await service.resume(); await vi.advanceTimersByTimeAsync(90000);
    expect(api.remoteAgentReconnect).toHaveBeenCalledTimes(6); expect(service.state.profiles).toHaveLength(1); await service.dispose();
  });
  it('explicit disconnect disables automatic restore and preserves profiles', async () => {
    const { api, service } = fixture(); await service.resume(); await service.disconnect(); await service.resume();
    expect(api.remoteAgentReconnect).toHaveBeenCalledTimes(1); expect(service.state.profiles[0].autoReconnect).toBe(false); await service.dispose();
  });
  it('does not reset its retry budget when every restored watch immediately fails', async () => {
    vi.useFakeTimers(); const { api, service } = fixture();
    api.remoteAgentWatch.mockRejectedValue('REMOTE_DISCONNECTED');
    await service.resume(); await vi.advanceTimersByTimeAsync(90000);
    expect(api.remoteAgentReconnect).toHaveBeenCalledTimes(6);
    expect(service.state.retries).toBe(5); await service.dispose();
  });
  it('surfaces a failed disconnect preference write after closing the socket', async () => {
    const { api, service } = fixture(); await service.resume();
    api.remoteAgentProfileUpdate.mockRejectedValueOnce('REMOTE_STORAGE');
    await service.disconnect(); expect(service.state.error).toBe('REMOTE_STORAGE');
    expect(service.state.connection).toBeNull(); await service.dispose();
  });
  it('does not publish a late save after the user locks the vault', async () => {
    const { api, service } = fixture(); let resolve;
    api.remoteAgentSave = vi.fn(() => new Promise(r => { resolve = r; }));
    const save = service.save({ endpoint: 'https://test.invalid/', token: 'test' }, 'Test');
    await vi.waitFor(() => expect(api.remoteAgentSave).toHaveBeenCalledTimes(1));
    await service.lock(); resolve({ connectionId: 'late', profileId: 'p1' });
    expect(await save).toBe(false); expect(service.state.connection).toBeNull();
    expect(service.state.selectedProfileId).toBe(''); await service.dispose();
  });
  it('unknown outcomes require review even after reconnect', async () => {
    const { api, service, profiles } = fixture(); profiles[0].uncertainSessions = ['s1'];
    await service.resume(); expect(await service.send('again', 'r2')).toBe(false); expect(api.remoteAgentAction).not.toHaveBeenCalled();
    await service.reviewed(); expect(service.needsReview()).toBe(false); expect(await service.send('new input', 'r3')).toBe(true); await service.dispose();
  });
  it('forget removes local profile without sending cancel or deleting remote work', async () => {
    const { api, service } = fixture(); await service.resume(); await service.forget('p1');
    expect(service.state.profiles).toEqual([]); expect(service.state.connection).toBeNull(); expect(api.remoteAgentAction).not.toHaveBeenCalled(); await service.dispose();
  });
  it('lock closes the connection and clears visible saved profiles', async () => {
    const { api, service } = fixture(); await service.resume(); await service.lock();
    expect(service.state.unlocked).toBe(false); expect(service.state.connection).toBeNull(); expect(api.remoteAgentLock).toHaveBeenCalledTimes(1); await service.dispose();
  });

  it('stages QR invitations for confirmation without exposing tokens or connecting early', async () => {
    const { api, service } = fixture();
    api.remoteAgentSave = vi.fn();
    const token = 'synth+token/2026=alpha&beta%25gamma';
    const qr =
      `bob://remote-agent?v=1&adapter=dsh` +
      `&name=${encodeURIComponent('X1T 远程节点')}` +
      `&endpoint=${encodeURIComponent('https://node2.invalid')}` +
      `&token=${encodeURIComponent(token)}`;

    expect(service.stageQr(qr)).toBe(true);
    expect(service.state.pendingQr).toEqual({
      v: '1',
      adapter: 'dsh',
      name: 'X1T 远程节点',
      endpoint: 'https://node2.invalid',
      supported: true,
    });
    expect(JSON.stringify(service.state)).not.toContain(token);
    expect(api.remoteAgentSave).not.toHaveBeenCalled();

    service.cancelQr();
    expect(service.state.pendingQr).toBeNull();
    expect(await service.confirmQr()).toBe(false);
    expect(api.remoteAgentSave).not.toHaveBeenCalled();
    await service.dispose();
  });

  it('recognizes adapter=bob-core in QR invitations but blocks connection with explicit unsupported error', async () => {
    const { api, service } = fixture();
    api.remoteAgentSave = vi.fn();
    const qr =
      'bob://remote-agent?v=1&adapter=bob-core&name=Bob%20Online&endpoint=https%3A%2F%2Fagent.bobbik.org&token=synth-core-token';

    expect(service.stageQr(qr)).toBe(true);
    expect(service.state.pendingQr).toEqual({
      v: '1',
      adapter: 'bob-core',
      name: 'Bob Online',
      endpoint: 'https://agent.bobbik.org',
      supported: false,
    });
    expect(service.state.error).toBe('REMOTE_BOB_CORE_UNSUPPORTED');
    expect(JSON.stringify(service.state)).not.toContain('synth-core-token');
    expect(await service.confirmQr()).toBe(false);
    expect(api.remoteAgentSave).not.toHaveBeenCalled();
    await service.dispose();
  });

  it('does not overwrite existing connections or disconnect active session when QR auth fails or duplicates endpoint', async () => {
    const { api, service, profiles } = fixture();
    await service.resume();
    expect(service.state.connection?.profileId).toBe('p1');

    api.remoteAgentSave = vi.fn(async () => {
      throw 'REMOTE_AUTH';
    });

    // 1. Duplicate endpoint is blocked before calling remoteAgentSave
    const duplicateQr =
      'bob://remote-agent?v=1&adapter=dsh&name=OverwriteAttempt&endpoint=https%3A%2F%2Ftest.invalid&token=synth-dup-token';
    expect(service.stageQr(duplicateQr)).toBe(true);
    expect(await service.confirmQr()).toBe(false);
    expect(service.state.error).toBe('REMOTE_QR_OVERWRITE_BLOCKED');
    expect(api.remoteAgentSave).not.toHaveBeenCalled();
    expect(service.state.profiles).toHaveLength(1);
    expect(service.state.profiles[0].name).toBe('Test');
    expect(service.state.connection?.profileId).toBe('p1');

    // 2. Auth failure on a new endpoint preserves existing connection and profiles
    const badAuthQr =
      'bob://remote-agent?v=1&adapter=dsh&name=Node2&endpoint=https%3A%2F%2Fnode2.invalid&token=synth-bad-token';
    expect(service.stageQr(badAuthQr)).toBe(true);
    expect(await service.confirmQr()).toBe(false);
    expect(service.state.error).toBe('REMOTE_AUTH');
    expect(service.state.pendingQr).toBeNull();
    expect(profiles).toHaveLength(1);
    expect(service.state.profiles).toHaveLength(1);
    expect(service.state.connection?.profileId).toBe('p1');
    expect(api.remoteAgentAction).not.toHaveBeenCalled();
    await service.dispose();
  });

  it('unlocks vault, authenticates DSH, saves alongside existing profiles, and recovers after lock/restart', async () => {
    const { api, service, profiles } = fixture();
    await service.lock();
    expect(service.state.unlocked).toBe(false);

    const specialToken = 'synth+tok/2026=1&2%253';
    api.remoteAgentSave = vi.fn(async (input, name) => {
      expect(input).toEqual({
        adapter: 'dsh',
        endpoint: 'https://node2.invalid',
        token: specialToken,
      });
      const created = {
        id: 'p2',
        name,
        endpoint: 'https://node2.invalid/',
        sessionId: '',
        autoReconnect: true,
        uncertainSessions: [],
      };
      profiles.push(created);
      return {
        connectionId: 'c2',
        profileId: 'p2',
        adapter: 'dsh',
        endpoint: 'https://node2.invalid/',
        capabilities: { catalog: true, history: true, send: true },
      };
    });
    api.remoteAgentReconnect = vi.fn(async id => ({
      connectionId: `re-${id}`,
      profileId: id,
      adapter: 'dsh',
      endpoint: id === 'p2' ? 'https://node2.invalid/' : 'https://test.invalid/',
      capabilities: { catalog: true, history: true, send: true },
    }));

    const qr =
      `bob://remote-agent?v=1&adapter=dsh` +
      `&name=${encodeURIComponent('X1T 扫码节点')}` +
      `&endpoint=${encodeURIComponent('https://node2.invalid')}` +
      `&token=${encodeURIComponent(specialToken)}`;

    expect(service.stageQr(qr)).toBe(true);
    expect(await service.confirmQr()).toBe(true);
    expect(api.remoteAgentUnlock).toHaveBeenCalledTimes(1);
    expect(api.remoteAgentSave).toHaveBeenCalledTimes(1);
    expect(api.remoteAgentAction).not.toHaveBeenCalled();
    expect(service.state.unlocked).toBe(true);
    expect(service.state.connection?.profileId).toBe('p2');
    expect(service.state.profiles.map(p => p.id)).toEqual(['p1', 'p2']);
    expect(JSON.stringify(service.state)).not.toContain(specialToken);

    // Lock vault and simulate restart recovery without QR token
    await service.lock();
    expect(service.state.unlocked).toBe(false);
    expect(service.state.connection).toBeNull();

    expect(await service.unlock()).toBe(true);
    expect(service.state.profiles.map(p => p.id)).toEqual(['p1', 'p2']);
    expect(await service.connectProfile('p2')).toBe(true);
    expect(service.state.connection?.profileId).toBe('p2');
    expect(api.remoteAgentSave).toHaveBeenCalledTimes(1);
    await service.dispose();
  });

  it('clears staged QR credentials when system unlock is cancelled or vault is locked', async () => {
    const { api, service } = fixture();
    await service.lock();
    api.remoteAgentUnlock.mockRejectedValueOnce('REMOTE_SYSTEM_AUTH_CANCELLED');
    api.remoteAgentSave = vi.fn();

    const qr =
      'bob://remote-agent?v=1&adapter=dsh&name=NodeCancel&endpoint=https%3A%2F%2Fcancel.invalid&token=synth-cancel-token';
    expect(service.stageQr(qr)).toBe(true);
    expect(await service.confirmQr()).toBe(false);
    expect(service.state.error).toBe('REMOTE_SYSTEM_AUTH_CANCELLED');
    expect(service.state.pendingQr).toBeNull();
    expect(await service.confirmQr()).toBe(false);
    expect(api.remoteAgentSave).not.toHaveBeenCalled();
    expect(JSON.stringify(service.state)).not.toContain('synth-cancel-token');
    await service.dispose();
  });
});
