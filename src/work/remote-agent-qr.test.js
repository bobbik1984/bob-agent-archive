import { describe, it, expect } from 'vitest';
import {
  KNOWN_REMOTE_AGENT_ADAPTERS,
  SUPPORTED_REMOTE_AGENT_ADAPTERS,
  isRemoteAgentQrCandidate,
  isSensitiveTokenUrl,
  parseRemoteAgentQr,
} from './remote-agent-qr.js';

describe('parseRemoteAgentQr protocol validation and test vectors', () => {
  it('accepts only secret-free Core v2 invitations', () => {
    const qr = 'bob://remote-agent?v=2&adapter=bob-core&name=Core&endpoint=https%3A%2F%2Fcore.invalid';
    expect(parseRemoteAgentQr(qr)).toEqual({ ok: true, v: '2', adapter: 'bob-core', name: 'Core', endpoint: 'https://core.invalid', supported: true });
    for (const suffix of ['&token=secret', '&principal_id=other', '&v=2', '&verifier=secret']) expect(parseRemoteAgentQr(qr+suffix).ok).toBe(false);
    expect(parseRemoteAgentQr(qr.replace('v=2','v=3')).ok).toBe(false);
  });
  it('exports the canonical adapter lists for cloud-agent alignment', () => {
    expect(KNOWN_REMOTE_AGENT_ADAPTERS).toEqual(['dsh', 'bob-core']);
    expect(SUPPORTED_REMOTE_AGENT_ADAPTERS).toEqual(['dsh', 'bob-core']);
  });

  it('parses Chinese node names and preserves special token characters (+ / = & %) with single decoding', () => {
    const rawName = 'X1T 远程工作台 · 节点一';
    const rawEndpoint = 'https://x1t-dsh.bobbik.org';
    const rawToken = 'synth+tok/2026=alpha&beta%25gamma%2Bdelta';
    const qrUri =
      `bob://remote-agent?v=1&adapter=dsh` +
      `&name=${encodeURIComponent(rawName)}` +
      `&endpoint=${encodeURIComponent(rawEndpoint)}` +
      `&token=${encodeURIComponent(rawToken)}`;

    expect(isRemoteAgentQrCandidate(qrUri)).toBe(true);
    const result = parseRemoteAgentQr(qrUri);
    expect(result).toEqual({
      ok: true,
      v: '1',
      adapter: 'dsh',
      name: rawName,
      endpoint: 'https://x1t-dsh.bobbik.org',
      token: rawToken,
      supported: true,
    });
  });

  it('does not convert unencoded + in token to space and never double-decodes %2B', () => {
    const uri =
      'bob://remote-agent?v=1&adapter=dsh&name=Node&endpoint=https%3A%2F%2Fdsh.example.com%2F&token=ab+cd%2Bef%252Bgh%2Fij%3Dkl%26mn';
    const result = parseRemoteAgentQr(uri);
    expect(result).toEqual({
      ok: true,
      v: '1',
      adapter: 'dsh',
      name: 'Node',
      endpoint: 'https://dsh.example.com',
      token: 'ab+cd+ef%2Bgh/ij=kl&mn',
      supported: true,
    });
  });

  it('recognizes adapter=bob-core but marks it as unsupported for connection', () => {
    const uri =
      'bob://remote-agent?v=1&adapter=bob-core&name=Bob%20Online%20(%E4%BA%91%E7%AB%AF)&endpoint=https%3A%2F%2Fagent.bobbik.org&token=synth-core-ticket-001';
    const result = parseRemoteAgentQr(uri);
    expect(result).toEqual({
      ok: true,
      v: '1',
      adapter: 'bob-core',
      name: 'Bob Online (云端)',
      endpoint: 'https://agent.bobbik.org',
      token: 'synth-core-ticket-001',
      supported: false,
    });
  });

  it('rejects duplicate parameters, missing parameters, and unknown parameters', () => {
    const duplicateToken =
      'bob://remote-agent?v=1&adapter=dsh&name=Node&endpoint=https%3A%2F%2Fdsh.example.com&token=t1&token=t2';
    expect(parseRemoteAgentQr(duplicateToken)).toEqual({
      ok: false,
      error: 'REMOTE_QR_DUPLICATE_PARAM',
    });

    const duplicateVersion =
      'bob://remote-agent?v=1&v=1&adapter=dsh&name=Node&endpoint=https%3A%2F%2Fdsh.example.com&token=t1';
    expect(parseRemoteAgentQr(duplicateVersion)).toEqual({
      ok: false,
      error: 'REMOTE_QR_DUPLICATE_PARAM',
    });

    for (const missingUri of [
      'bob://remote-agent',
      'bob://remote-agent?',
      'bob://remote-agent?v=1&adapter=dsh&name=Node&endpoint=https%3A%2F%2Fdsh.example.com',
      'bob://remote-agent?v=1&adapter=dsh&name=&endpoint=https%3A%2F%2Fdsh.example.com&token=t1',
      'bob://remote-agent?v=1&adapter=dsh&name=Node&endpoint=https%3A%2F%2Fdsh.example.com&token=',
    ]) {
      expect(parseRemoteAgentQr(missingUri)).toEqual({
        ok: false,
        error: 'REMOTE_QR_MISSING_PARAM',
      });
    }

    const extraParam =
      'bob://remote-agent?v=1&adapter=dsh&name=Node&endpoint=https%3A%2F%2Fdsh.example.com&token=t1&extra=1';
    expect(parseRemoteAgentQr(extraParam)).toEqual({
      ok: false,
      error: 'REMOTE_QR_INVALID',
    });
  });

  it('rejects wrong scheme, wrong host, unknown versions, and unknown adapters', () => {
    for (const invalidSchemeOrHost of [
      'https://remote-agent?v=1&adapter=dsh&name=Node&endpoint=https%3A%2F%2Fdsh.example.com&token=t1',
      'bob://pair?v=1&adapter=dsh&name=Node&endpoint=https%3A%2F%2Fdsh.example.com&token=t1',
      'bob:remote-agent?v=1&adapter=dsh&name=Node&endpoint=https%3A%2F%2Fdsh.example.com&token=t1',
      'bob://remote-agent:8080?v=1&adapter=dsh&name=Node&endpoint=https%3A%2F%2Fdsh.example.com&token=t1',
      'bob://user:pass@remote-agent?v=1&adapter=dsh&name=Node&endpoint=https%3A%2F%2Fdsh.example.com&token=t1',
      'bob://remote-agent/subpath?v=1&adapter=dsh&name=Node&endpoint=https%3A%2F%2Fdsh.example.com&token=t1',
      'bob://remote-agent?v=1&adapter=dsh&name=Node&endpoint=https%3A%2F%2Fdsh.example.com&token=t1#frag',
    ]) {
      expect(parseRemoteAgentQr(invalidSchemeOrHost)).toEqual({
        ok: false,
        error: 'REMOTE_QR_INVALID',
      });
    }

    for (const badVersion of ['0', '2', '1.0', 'v1']) {
      const uri = `bob://remote-agent?v=${badVersion}&adapter=dsh&name=Node&endpoint=https%3A%2F%2Fdsh.example.com&token=t1`;
      expect(parseRemoteAgentQr(uri)).toEqual({
        ok: false,
        error: 'REMOTE_QR_VERSION',
      });
    }

    for (const badAdapter of ['ssh', 'openai', 'bearer', 'unknown']) {
      const uri = `bob://remote-agent?v=1&adapter=${badAdapter}&name=Node&endpoint=https%3A%2F%2Fdsh.example.com&token=t1`;
      expect(parseRemoteAgentQr(uri)).toEqual({
        ok: false,
        error: 'REMOTE_UNSUPPORTED_ADAPTER',
      });
    }
  });

  it('rejects non-HTTPS, credentialed, sub-path, query, hash, or loopback endpoints', () => {
    for (const unsafeEndpoint of [
      'http://dsh.example.com',
      'http://127.0.0.1:3080',
      'https://127.0.0.1:3080',
      'https://localhost:3080',
      'https://[::1]:3080',
      'https://user:pass@dsh.example.com',
      'https://user@dsh.example.com',
      'https://dsh.example.com/connect',
      'https://dsh.example.com/api/remote.mux',
      'https://dsh.example.com/?token=leak',
      'https://dsh.example.com?',
      'https://dsh.example.com#frag',
      'https://dsh.example.com#',
      'javascript:alert(1)',
    ]) {
      const uri =
        `bob://remote-agent?v=1&adapter=dsh&name=Node` +
        `&endpoint=${encodeURIComponent(unsafeEndpoint)}&token=synth-token`;
      expect(parseRemoteAgentQr(uri)).toEqual({
        ok: false,
        error: 'REMOTE_INVALID_URL',
      });
    }
  });

  it('detects sensitive token URLs so they are never forwarded to chat prompts', () => {
    expect(isSensitiveTokenUrl('https://x1t-dsh.bobbik.org/?token=synth-secret')).toBe(true);
    expect(isSensitiveTokenUrl('https://x1t-dsh.bobbik.org/connect?token=synth-secret')).toBe(true);
    expect(isSensitiveTokenUrl('bob://remote-agent?v=1&adapter=dsh&name=N&endpoint=https%3A%2F%2Fdsh.example.com&token=s')).toBe(true);
    expect(isSensitiveTokenUrl('https://example.com/article?id=123')).toBe(false);
  });
});
