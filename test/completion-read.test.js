import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCompletionReadBridge } from '../src/completion-read.js';

const status = (running, completionUnread, extra = {}) => Object.freeze({ running, completionUnread, pendingInteraction: undefined, ...extra });
function fixture(initial = new Map()) {
  let raw = initial;
  const subscriptions = new Set();
  const source = {
    getSnapshot: () => raw,
    // Match UiSession exactly: the native implementation stores callbacks in
    // a Set, rather than allocating an independent record for each subscribe.
    subscribe: listener => {
      subscriptions.add(listener);
      return () => subscriptions.delete(listener);
    },
  };
  return {
    source,
    publish(next) {
      raw = next;
      for (const listener of [...subscriptions]) listener();
    },
    count: () => subscriptions.size,
    raw: () => raw,
  };
}

// These tests exercise the actual pure compatibility adapter. No React/DOM
// rendering is emulated and none of the fixtures are presented as live UI proof.
test('visible running session finishes without an unread reminder; raw status is untouched', () => {
  const f = fixture(new Map([['a', status(true, false)]]));
  const bridge = createCompletionReadBridge(f.source);
  const release = bridge.retainVisible('a');
  const done = status(false, true);
  f.publish(new Map([['a', done]]));
  assert.equal(f.source.getSnapshot().get('a').completionUnread, false);
  assert.equal(f.raw().get('a'), done);
  assert.equal(done.completionUnread, true);
  release();
  assert.equal(f.source.getSnapshot().get('a').completionUnread, false);
  bridge.dispose();
});

test('opening an already completed session acknowledges it and notifies the UI immediately', () => {
  const f = fixture(new Map([['a', status(false, true)]]));
  const bridge = createCompletionReadBridge(f.source);
  let calls = 0;
  const off = f.source.subscribe(() => { calls++; });
  const release = bridge.retainVisible('a');
  assert.equal(calls, 1);
  assert.equal(f.source.getSnapshot().get('a').completionUnread, false);
  release();
  assert.equal(calls, 1);
  assert.equal(f.source.getSnapshot().get('a').completionUnread, false);
  off();
  bridge.dispose();
});

test('hiding a still-running body preserves the reminder for its later background completion', () => {
  const f = fixture(new Map([['a', status(true, false)]]));
  const bridge = createCompletionReadBridge(f.source);
  const release = bridge.retainVisible('a');
  release();
  f.publish(new Map([['a', status(false, true)]]));
  assert.equal(f.source.getSnapshot().get('a').completionUnread, true);
  bridge.dispose();
});

test('a new run resets the acknowledgement and the next hidden completion is unread', () => {
  const f = fixture(new Map([['a', status(false, true)]]));
  const bridge = createCompletionReadBridge(f.source);
  bridge.retainVisible('a')();
  assert.equal(f.source.getSnapshot().get('a').completionUnread, false);
  f.publish(new Map([['a', status(true, false)]]));
  f.publish(new Map([['a', status(false, true)]]));
  assert.equal(f.source.getSnapshot().get('a').completionUnread, true);
  bridge.dispose();
});

test('native acknowledgement and session removal both retire a previous completion cycle', () => {
  for (const middle of [new Map([['a', status(false, false)]]), new Map()]) {
    const f = fixture(new Map([['a', status(false, true)]]));
    const bridge = createCompletionReadBridge(f.source);
    bridge.retainVisible('a')();
    f.publish(middle);
    f.publish(new Map([['a', status(false, true)]]));
    assert.equal(f.source.getSnapshot().get('a').completionUnread, true);
    bridge.dispose();
  }
});

test('two visible bodies use independent idempotent holds', () => {
  const f = fixture(new Map([['a', status(true, false)]]));
  const bridge = createCompletionReadBridge(f.source);
  const first = bridge.retainVisible('a');
  const second = bridge.retainVisible('a');
  first(); first();
  f.publish(new Map([['a', status(false, true)]]));
  assert.equal(f.source.getSnapshot().get('a').completionUnread, false);
  second(); second();
  f.publish(new Map([['a', status(true, false)]]));
  f.publish(new Map([['a', status(false, true)]]));
  assert.equal(f.source.getSnapshot().get('a').completionUnread, true);
  bridge.dispose();
});

test('snapshot getters are stable and do not notify or mutate the source', () => {
  const f = fixture(new Map([['a', status(false, true)], ['b', status(false, true)]]));
  const bridge = createCompletionReadBridge(f.source);
  let calls = 0;
  const off = f.source.subscribe(() => { calls++; });
  assert.equal(f.source.getSnapshot(), f.raw());
  const release = bridge.retainVisible('a');
  const snapshot = f.source.getSnapshot();
  for (let i = 0; i < 50; i++) assert.equal(f.source.getSnapshot(), snapshot);
  assert.equal(calls, 1);
  assert.equal(snapshot.get('b'), f.raw().get('b'));
  const second = bridge.retainVisible('a');
  assert.equal(f.source.getSnapshot(), snapshot);
  release(); second();
  off(); bridge.dispose();
});

test('running, approval, unknown fields and unrelated sessions preserve their semantics', () => {
  const pending = Object.freeze({ key: 'approval', kind: 'approval', sessionId: 'a' });
  const a = status(false, true, { pendingInteraction: pending, futureField: 42 });
  const b = status(true, false, { futureField: 'b' });
  const f = fixture(new Map([['a', a], ['b', b]]));
  const bridge = createCompletionReadBridge(f.source);
  bridge.retainVisible('a');
  assert.deepEqual(f.source.getSnapshot().get('a'), { ...a, completionUnread: false });
  assert.equal(f.source.getSnapshot().get('a').pendingInteraction, pending);
  assert.equal(f.source.getSnapshot().get('b'), b);
  assert.equal(f.raw().get('a'), a);
  bridge.dispose();
});

test('native notifications refresh before UI reads and do not duplicate broadcasts', () => {
  const f = fixture(new Map([['a', status(true, false)]]));
  const bridge = createCompletionReadBridge(f.source);
  bridge.retainVisible('a');
  const seen = [];
  const off = f.source.subscribe(() => { seen.push(f.source.getSnapshot().get('a').completionUnread); });
  f.publish(new Map([['a', status(false, true)]]));
  assert.deepEqual(seen, [false]);
  off(); bridge.dispose();
});

test('observes completions even while there are no sidebar subscribers', () => {
  const f = fixture(new Map([['a', status(true, false)]]));
  const bridge = createCompletionReadBridge(f.source);
  const release = bridge.retainVisible('a');
  f.publish(new Map([['a', status(false, true)]]));
  release();
  assert.equal(f.source.getSnapshot().get('a').completionUnread, false);
  bridge.dispose();
});

test('duplicate listener functions own separate subscriptions and either can unsubscribe', () => {
  const f = fixture(new Map([['a', status(false, true)]]));
  const bridge = createCompletionReadBridge(f.source);
  let calls = 0;
  const listener = () => { calls++; };
  const off1 = f.source.subscribe(listener);
  const off2 = f.source.subscribe(listener);
  off1(); off1();
  bridge.retainVisible('a');
  assert.equal(calls, 1);
  assert.equal(f.count(), 2); // adapter observer + the second consumer
  f.publish(new Map([['a', status(true, false)]]));
  assert.equal(calls, 2); // off1 must not detach off2 from native events
  off2(); bridge.dispose();
  assert.equal(f.count(), 0);
});

test('disposal restores public descriptors and leaves consumers live on the native source', () => {
  const f = fixture(new Map([['a', status(false, true)]]));
  const before = Object.getOwnPropertyDescriptors(f.source);
  const bridge = createCompletionReadBridge(f.source);
  const seen = [];
  const off = f.source.subscribe(() => { seen.push(f.source.getSnapshot().get('a').completionUnread); });
  const release = bridge.retainVisible('a');
  bridge.dispose(); bridge.dispose(); release();
  assert.deepEqual(Object.getOwnPropertyDescriptors(f.source), before);
  assert.deepEqual(seen, [false, true]);
  assert.equal(f.count(), 1);
  f.publish(new Map([['a', status(false, false)]]));
  assert.deepEqual(seen, [false, true, false]);
  off();
  assert.equal(f.count(), 0);
  bridge.retainVisible('a')();
});

test('a later decorator is not overwritten, and captured inactive methods pass through', () => {
  const f = fixture(new Map([['a', status(false, true)]]));
  const nativeGet = f.source.getSnapshot;
  const nativeSubscribe = f.source.subscribe;
  const bridge = createCompletionReadBridge(f.source);
  const innerGet = f.source.getSnapshot;
  const innerSubscribe = f.source.subscribe;
  const outerGet = () => innerGet();
  const outerSubscribe = listener => innerSubscribe(listener);
  f.source.getSnapshot = outerGet;
  f.source.subscribe = outerSubscribe;
  bridge.retainVisible('a');
  bridge.dispose();
  assert.equal(f.source.getSnapshot, outerGet);
  assert.equal(f.source.subscribe, outerSubscribe);
  assert.equal(f.source.getSnapshot(), nativeGet());
  const off = f.source.subscribe(() => {});
  assert.equal(f.count(), 1);
  off();
  assert.equal(f.count(), 0);
  f.source.getSnapshot = nativeGet;
  f.source.subscribe = nativeSubscribe;
});

test('listener errors are isolated from other visibility subscribers', () => {
  const f = fixture(new Map([['a', status(false, true)]]));
  const errors = [];
  const bridge = createCompletionReadBridge(f.source, error => errors.push(error));
  const off1 = f.source.subscribe(() => { throw new Error('listener failed'); });
  let calls = 0;
  const off2 = f.source.subscribe(() => { calls++; });
  bridge.retainVisible('a');
  assert.equal(errors.length, 1);
  assert.equal(calls, 1);
  off1(); off2(); bridge.dispose();
});

test('unsupported or frozen source shapes fail before changing anything', () => {
  assert.throws(() => createCompletionReadBridge(undefined), /compatible Session status/);
  const bad = fixture({});
  const beforeBad = Object.getOwnPropertyDescriptors(bad.source);
  assert.throws(() => createCompletionReadBridge(bad.source), /Unsupported Session status/);
  assert.deepEqual(Object.getOwnPropertyDescriptors(bad.source), beforeBad);
  assert.equal(bad.count(), 0);
  const frozen = fixture();
  Object.freeze(frozen.source);
  const beforeFrozen = Object.getOwnPropertyDescriptors(frozen.source);
  assert.throws(() => createCompletionReadBridge(frozen.source), /safely decorated/);
  assert.deepEqual(Object.getOwnPropertyDescriptors(frozen.source), beforeFrozen);
  assert.equal(frozen.count(), 0);
});

test('reload cycles restore the public source without accumulating adapter subscriptions', () => {
  const f = fixture(new Map([['a', status(false, true)]]));
  const original = Object.getOwnPropertyDescriptors(f.source);
  for (let i = 0; i < 20; i++) {
    const bridge = createCompletionReadBridge(f.source);
    const off = f.source.subscribe(() => {});
    bridge.retainVisible('a')();
    off(); bridge.dispose();
    assert.equal(f.count(), 0);
    assert.deepEqual(Object.getOwnPropertyDescriptors(f.source), original);
  }
});

test('integration uses body visibility + successful opening and never retains mainView', async () => {
  const code = await readFile(new URL('../src/client.js', import.meta.url), 'utf8');
  assert.match(code, /targetVisible: tab\.visible === true, targetReady: ready && !error/);
  assert.match(code, /React\.useLayoutEffect/);
  assert.match(code, /if \(!targetReady \|\| !targetVisible \|\| !targetSessionId\)/);
  assert.match(code, /reference\.ready\.then/);
  assert.match(code, /source: 'sidebarChat'/);
  assert.doesNotMatch(code, /source:\s*['"]mainView['"]/);
  assert.match(code, /await seat\.dispose\(\);\s+await disposeCompletion\(\);/);
});
