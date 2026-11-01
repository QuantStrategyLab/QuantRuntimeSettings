import { ProxyError } from './hmac.js';
import { googleTransport } from './secretManager.js';
// All instances share Firestore's serializable transaction boundary. There is no
// in-memory replay fallback. Documents contain workflow data only.
export function createFirestoreStore(database, { transport = googleTransport() } = {}) {
  if (!/^projects\/[a-z0-9-]+\/databases\/\([a-z]+\)$/.test(database || '')) throw new ProxyError();
  const base = 'https://firestore.googleapis.com/v1/' + database + '/documents';
  const name = id => {
    if (!/^[a-z_]+\/[A-Za-z0-9_-]{1,256}$/.test(id)) throw new ProxyError();
    return database + '/documents/' + id;
  };
  const decode = raw => raw ? JSON.parse(raw.fields.record.stringValue) : null;
  return Object.freeze({
    async run(callback) {
      const { transaction } = await transport(base + ':beginTransaction', { method: 'POST', body: '{}' });
      if (typeof transaction !== 'string') throw new ProxyError();
      const writes = [];
      try {
        const result = await callback({
          get: async id => decode(await transport('https://firestore.googleapis.com/v1/' + name(id) + '?transaction=' + encodeURIComponent(transaction), {}, true)),
          put(id, record) {
            const fields = { record: { stringValue: JSON.stringify(record) } };
            // Only nonce documents have TTL. Operations/requests are retained
            // through reconciliation; provision retention separately afterward.
            if (record.expires_at) fields.expires_at = { timestampValue: record.expires_at };
            writes.push({ update: { name: name(id), fields } });
          },
        });
        await transport(base + ':commit', { method: 'POST', body: JSON.stringify({ transaction, writes }) });
        return result;
      } catch {
        try { await transport(base + ':rollback', { method: 'POST', body: JSON.stringify({ transaction }) }); } catch { /* fixed failure only */ }
        throw new ProxyError();
      }
    },
  });
}
export function createReplayStore(store, { now = Date.now } = {}) {
  if (typeof store?.run !== 'function') throw new ProxyError();
  return Object.freeze({
    async reserve(auth, action) {
      return store.run(async tx => {
        const nonceKey = `nonces/${auth.keyId}_${auth.nonce}`, requestKey = `requests/${auth.requestId}`;
        const nonce = await tx.get(nonceKey), request = await tx.get(requestKey);
        const operation = await tx.get(`operations/${auth.operationId}`), active = await tx.get('credentials/ibkr_flex');
        if (nonce && (nonce.request_id !== auth.requestId || nonce.fingerprint !== auth.fingerprint)) return { error: 'rotation_replay_conflict', status: 409 };
        if (request && (request.fingerprint !== auth.fingerprint || request.operation_id !== auth.operationId)) return { error: 'rotation_request_conflict', status: 409 };
        tx.put(nonceKey, { request_id: auth.requestId, fingerprint: auth.fingerprint, expires_at: new Date(now() + 600000).toISOString() });
        if (request) return { operation, replayed: true };
        if (action === 'read' || action === 'metadata') return { operation, replayed: false };
        if (action === 'stage' ? operation || active?.active : !operation || operation.state !== 'staged') return { error: 'rotation_state_conflict', status: 409 };
        const op = { ...(operation || { operation_id: auth.operationId }), state: { stage: 'adding_version', finalize: 'finalizing', cancel: 'canceling' }[action],
          action, request_id: auth.requestId, updated_at: new Date(now()).toISOString() };
        tx.put(requestKey, { operation_id: auth.operationId, fingerprint: auth.fingerprint });
        tx.put(`operations/${auth.operationId}`, op);
        tx.put('credentials/ibkr_flex', { active: true, operation_id: auth.operationId });
        return { operation: op, replayed: false };
      });
    },
    async update(operation, expectedState) {
      return store.run(async tx => {
        const old = await tx.get(`operations/${operation.operation_id}`);
        const active = await tx.get('credentials/ibkr_flex');
        if (!old || (expectedState && old.state !== expectedState)) return old;
        tx.put(`operations/${operation.operation_id}`, operation);
        if (['finalized', 'canceled', 'failed'].includes(operation.state) && active?.operation_id === operation.operation_id)
          tx.put('credentials/ibkr_flex', { active: false, operation_id: operation.operation_id });
        return operation;
      });
    },
  });
}
