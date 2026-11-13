/**
 * Compatibility adapter for DSH 0.2.2-rc.2's public Session-status observable.
 * There is no native completion acknowledgement API in that release. Decorate
 * only getSnapshot/subscribe: never touch private state, mainView or selection.
 * Install before React mounts (refresh the page after installation/upgrades).
 */
export function createCompletionReadBridge(source, reportError = () => {}) {
  if (!source || typeof source.getSnapshot !== 'function' || typeof source.subscribe !== 'function') {
    throw new Error('[session-split] This DSH version has no compatible Session status observable');
  }
  const getDescriptor = Object.getOwnPropertyDescriptor(source, 'getSnapshot');
  const subscribeDescriptor = Object.getOwnPropertyDescriptor(source, 'subscribe');
  if (!getDescriptor?.configurable || !subscribeDescriptor?.configurable
    || typeof getDescriptor.value !== 'function' || typeof subscribeDescriptor.value !== 'function') {
    throw new Error('[session-split] Session status methods cannot be safely decorated');
  }
  const originalGet = getDescriptor.value;
  const originalSubscribe = subscribeDescriptor.value;
  const initial = originalGet.call(source);
  if (!(initial instanceof Map)) {
    throw new Error('[session-split] Unsupported Session status snapshot');
  }

  const visible = new Map();
  const acknowledged = new Set();
  const listeners = new Set();
  let active = true;
  let lastRaw;
  let lastAcknowledged = new Set();
  let snapshot = initial;

  function refresh() {
    const raw = originalGet.call(source);
    // An acknowledgement belongs to this completion cycle only. A new run,
    // native acknowledgement, or removal must restore normal reminder behavior.
    for (const id of acknowledged) {
      const status = raw.get(id);
      if (!status || status.running === true || status.completionUnread !== true) acknowledged.delete(id);
    }
    for (const id of visible.keys()) {
      const status = raw.get(id);
      if (status?.completionUnread === true && status.running !== true) acknowledged.add(id);
    }
    const sameAcknowledged = acknowledged.size === lastAcknowledged.size
      && [...acknowledged].every(id => lastAcknowledged.has(id));
    if (raw === lastRaw && sameAcknowledged) return snapshot;
    lastRaw = raw;
    lastAcknowledged = new Set(acknowledged);
    // Return the original snapshot and unchanged status records whenever possible.
    snapshot = acknowledged.size === 0 ? raw : new Map(raw);
    for (const id of acknowledged) {
      snapshot.set(id, { ...raw.get(id), completionUnread: false });
    }
    return snapshot;
  }

  // useSyncExternalStore requires a side-effect-free, stable snapshot getter.
  function read() {
    return active ? snapshot : originalGet.call(source);
  }

  function notify() {
    for (const { listener } of [...listeners]) {
      try { listener(); } catch (error) { reportError(error); }
    }
  }

  function subscribe(listener) {
    // Every consumer remains directly subscribed to the original source. This
    // subscription survives adapter disposal until the consumer itself releases it.
    // The native source deduplicates callbacks in a Set. Give every subscription
    // a distinct callback so releasing one cannot detach another identical listener.
    const nativeListener = () => listener();
    const unsubscribe = originalSubscribe.call(source, nativeListener);
    if (!active) return unsubscribe;
    const record = { listener };
    listeners.add(record);
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      listeners.delete(record);
      unsubscribe();
    };
  }

  refresh();
  // Observe every native transition even if the sidebar is temporarily unmounted.
  // Installed before React mounts, this observer refreshes before UI listeners.
  // Native notifications already reach every subscriber; do not broadcast twice.
  const unsubscribeWatch = originalSubscribe.call(source, () => { if (active) refresh(); });
  try {
    Object.defineProperty(source, 'getSnapshot', { ...getDescriptor, value: read });
    Object.defineProperty(source, 'subscribe', { ...subscribeDescriptor, value: subscribe });
  } catch (error) {
    if (source.getSnapshot === read) Object.defineProperty(source, 'getSnapshot', getDescriptor);
    unsubscribeWatch();
    throw error;
  }

  return {
    retainVisible(sessionId) {
      if (!active || !sessionId) return () => {};
      const before = snapshot;
      visible.set(sessionId, (visible.get(sessionId) || 0) + 1);
      refresh();
      if (snapshot !== before) notify();
      let held = true;
      return () => {
        if (!held || !active) return;
        held = false;
        const count = visible.get(sessionId) || 0;
        if (count > 1) visible.set(sessionId, count - 1);
        else visible.delete(sessionId);
        // Keep this cycle's acknowledgement after hiding; it was already seen.
      };
    },
    dispose() {
      if (!active) return;
      active = false;
      unsubscribeWatch();
      // Never overwrite a decorator another plugin installed after ours.
      if (source.getSnapshot === read) Object.defineProperty(source, 'getSnapshot', getDescriptor);
      if (source.subscribe === subscribe) Object.defineProperty(source, 'subscribe', subscribeDescriptor);
      visible.clear();
      acknowledged.clear();
      lastAcknowledged.clear();
      lastRaw = undefined;
      snapshot = undefined;
      notify();
      listeners.clear();
    },
  };
}
