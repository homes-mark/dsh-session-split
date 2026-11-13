window.__ModuleLoader__.load({
  id: '@local/dsh-session-split',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /**
     * Compatibility adapter for DSH 0.2.2-rc.2's public Session-status observable.
     * There is no native completion acknowledgement API in that release. Decorate
     * only getSnapshot/subscribe: never touch private state, mainView or selection.
     * Install before React mounts (refresh the page after installation/upgrades).
     */
    function createCompletionReadBridge(source, reportError = () => {}) {
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

    const PACKAGE_ID = '@local/dsh-session-split';
    const TAB_TYPE_ID = '@local/dsh-session-split/native-v11';
    const TAB_KIND = 'sessionsplitv11';
    const RESOURCE_PROTOCOL = 'sessionsplitv11';
    const ADDRESS_PREFIX = `dsh-resource://${RESOURCE_PROTOCOL}/session/`;
    const LOCALE_NS = 'sessionSplitV11';

    const EN = {
      openRight: 'Open on the right',
      openRightTooltip: 'Open this exact session on the right without forking or starting a new turn',
      openFailed: 'Could not open the session on the right',
      loading: 'Loading session…',
      untitled: 'Session split',
    };
    const ZH = {
      openRight: '在右侧打开',
      openRightTooltip: '在右侧显示同一会话，不新建，也不自动续跑',
      openFailed: '无法在右侧打开这个会话',
      loading: '正在加载会话…',
      untitled: '会话分屏',
    };

    const CSS = `
      .dss-root { width: 100%; min-width: 0; height: 100%; min-height: 0; display: flex; }
      .dss-state {
        margin: auto; padding: 24px; max-width: 360px; color: var(--dsw-alias-label-secondary);
        font-size: 13px; line-height: 1.6; text-align: center; white-space: pre-wrap; overflow-wrap: anywhere;
      }
      .dss-error { color: var(--dsw-alias-state-error-primary); }
      .dss-menuItem {
        display: flex; align-items: center; gap: 8px; width: 100%; box-sizing: border-box;
        padding: 6px 10px; border: 0; border-radius: 6px; color: var(--dsw-alias-label-primary);
        background: transparent; font-family: inherit; font-size: 13px; line-height: 20px;
        text-align: left; cursor: pointer;
      }
      .dss-menuItem:hover, .dss-menuItem:focus-visible { background: var(--dsw-alias-bg-layer-2); }
      .dss-menuItem:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
      .dss-menuIcon {
        display: inline-flex; align-items: center; justify-content: center;
        width: 14px; height: 14px; flex: none; line-height: 0; color: var(--dsw-alias-label-secondary);
      }
      .dss-menuError {
        padding: 6px 12px 8px 36px; color: var(--dsw-alias-state-error-primary);
        background: var(--dsw-alias-bg-base); font-size: 12px; line-height: 1.45; white-space: pre-wrap;
      }
    `;

    function SplitIcon() {
      return h('svg', { width: 14, height: 14, viewBox: '0 0 20 20', fill: 'none', 'aria-hidden': true, focusable: false },
        h('rect', { x: 2.25, y: 3.25, width: 15.5, height: 13.5, rx: 2.25, stroke: 'currentColor', strokeWidth: 1.5 }),
        h('path', { d: 'M10 3.5v13', stroke: 'currentColor', strokeWidth: 1.5 }),
        h('path', { d: 'M12.5 8l2 2-2 2M16 10h-4', stroke: 'currentColor', strokeWidth: 1.35, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      );
    }

    function LocalStyles() {
      return h('style', { 'data-session-split-style': PACKAGE_ID }, CSS);
    }

    function sessionAddress(sessionId) {
      return `${ADDRESS_PREFIX}${encodeURIComponent(sessionId)}`;
    }

    function parseSessionAddress(value) {
      let url;
      try { url = new URL(value); } catch { return undefined; }
      if (url.protocol !== 'dsh-resource:' || url.hostname.toLowerCase() !== RESOURCE_PROTOCOL) return undefined;
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length !== 2 || parts[0] !== 'session') return undefined;
      try { return decodeURIComponent(parts[1]) || undefined; } catch { return undefined; }
    }

    function useSessionReference(sessions, sessionId) {
      const [state, setState] = React.useState({ id: '', reference: null, ready: false, error: '' });
      React.useEffect(() => {
        if (!sessionId) {
          setState({ id: '', reference: null, ready: false, error: '' });
          return undefined;
        }
        let active = true;
        let reference;
        const controller = new AbortController();
        const messageFor = (cause) => cause && typeof cause.message === 'string' ? cause.message : String(cause);
        try {
          reference = sessions.retain(sessionId, { source: 'sidebarChat', signal: controller.signal });
          setState({ id: sessionId, reference, ready: false, error: '' });
          reference.ready.then(() => {
            if (active) setState({ id: sessionId, reference, ready: true, error: '' });
          }, (cause) => {
            if (active) setState({ id: sessionId, reference, ready: false, error: messageFor(cause) });
          });
        } catch (cause) {
          setState({ id: sessionId, reference: null, ready: false, error: messageFor(cause) });
        }
        return () => {
          active = false;
          controller.abort();
          if (reference) reference.release();
        };
      }, [sessions, sessionId]);
      return state.id === sessionId ? state : { id: sessionId, reference: null, ready: false, error: '' };
    }

    function titleFor(address, sessions, t) {
      const sessionId = parseSessionAddress(address);
      if (sessionId === undefined) return t('untitled');
      const summary = sessions.list.getSnapshot().byId[sessionId];
      const projected = summary && summary.projectionValues;
      return (summary && summary.displayTitle)
        || (projected && (projected.title || projected.sessionTitle))
        || (summary && summary.cwd)
        || sessionId;
    }

    function FixedChatConversationView(props) {
      return h(React.Fragment, null, props.renderSlot('conversation.session', { view: 'chat' }));
    }

    function ConversationSlotPanel(props) {
      const { sessionId, useSession, useConversation, useSessions, renderFactorySlot } = props;
      const { completionRead, targetSessionId, targetVisible, targetReady } = props;
      // A committed, successfully opened body counts as viewed, not a retained
      // hidden tab or its title. Keeping this effect inside the render boundary
      // also prevents an initially crashing conversation from acknowledging it.
      React.useLayoutEffect(() => {
        if (!targetReady || !targetVisible || !targetSessionId) return undefined;
        return completionRead.retainVisible(targetSessionId);
      }, [completionRead, targetSessionId, targetReady, targetVisible]);
      const session = useSession((value) => value);
      const shellPhase = useConversation((value) => value).activeTargets.size > 0
        || !session.blank && !session.awaitingFirstTurn || session.running
        ? 'active' : session.promptAttempted ? 'engaging' : 'blank';
      const summaryBlank = useSessions((state) => state.byId[sessionId]?.blank);
      const settling = shellPhase === 'blank' && session.openState === 'loading' && summaryBlank !== true;
      const hero = shellPhase === 'blank' && (session.openState === 'open' || summaryBlank === true);
      return renderFactorySlot('conversation.content', {
        variant: 'embedded', phase: settling ? 'settling' : hero ? 'hero' : 'active', hero,
      }, { slots: { views: FixedChatConversationView } });
    }

    class ConversationBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: '' };
      }
      static getDerivedStateFromError(error) {
        return { error: error && error.message ? error.message : String(error) };
      }
      componentDidCatch(error) {
        console.error('[session-split] Conversation render failed', error);
      }
      render() {
        if (this.state.error) return h('div', { className: 'dss-state dss-error', role: 'alert' }, this.state.error);
        return this.props.children;
      }
    }

    function SessionSplitTabBody(props) {
      const { sessions, useTabInfo, SessionProvider, t } = props;
      const { tab } = useTabInfo();
      const sessionId = tab.navigation?.params?.targetSessionId || parseSessionAddress(tab.contentId);
      const { reference, ready, error } = useSessionReference(sessions, sessionId);
      return h('div', { className: 'dss-root', 'data-session-split': tab.contentId },
        h(LocalStyles),
        error ? h('div', { className: 'dss-state dss-error', role: 'alert' }, `${t('openFailed')}: ${error}`) : null,
        !error && !reference ? h('div', { className: 'dss-state', role: 'status' }, t('loading')) : null,
        !reference ? null : h(ConversationBoundary, null,
          h(SessionProvider, {
            session: reference,
            children: h(ConversationSlotPanel, {
              ...props, targetSessionId: sessionId,
              targetVisible: tab.visible === true, targetReady: ready && !error,
            }),
          }),
        ),
      );
    }

    class SlotErrorBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: '' };
      }
      static getDerivedStateFromError(error) {
        return { error: error && error.message ? error.message : String(error) };
      }
      componentDidCatch(error) {
        console.error('[session-split] Tab render failed', error);
      }
      render() {
        if (this.state.error) return h('div', { className: 'dss-state dss-error', role: 'alert' }, this.state.error);
        return this.props.children;
      }
    }

    function SessionSplitTab(props) {
      return h(SlotErrorBoundary, null, h(SessionSplitTabBody, { ...props }));
    }

    function SessionSplitTitle(props) {
      const { tab } = props.useTabInfo();
      return tab.navigation?.params?.title || tab.title || props.t('untitled');
    }

    function OpenRightMenuItem(props) {
      const [error, setError] = React.useState('');
      let openState = null;
      if (typeof props.useMenuOpenState === 'function') openState = props.useMenuOpenState();
      const closeMenu = () => {
        if (openState && typeof openState[1] === 'function') openState[1](false);
      };
      const open = (event) => {
        event.preventDefault();
        event.stopPropagation();
        setError('');
        try {
          props.right.openTab(TAB_KIND, {
            preferNewPane: true,
            params: { targetSessionId: props.sessionId, title: props.displayTitle },
          });
          closeMenu();
        } catch (cause) {
          const message = cause && typeof cause.message === 'string' ? cause.message : String(cause);
          setError(`${props.t('openFailed')}: ${message}`);
        }
      };
      return h(React.Fragment, null,
        h(LocalStyles),
        h('button', {
          type: 'button', role: 'menuitem', className: 'dss-menuItem',
          'data-session-split-open': props.sessionId,
          title: props.t('openRightTooltip'), onClick: open,
        },
          h('span', { className: 'dss-menuIcon' }, h(SplitIcon)),
          h('span', null, props.t('openRight')),
        ),
        error ? h('div', { className: 'dss-menuError', role: 'alert' }, error) : null,
      );
    }

    return {
      inject: ['slots', 'sessions', 'locale', 'sidebarRight', 'uiSession'],
      apply(ctx) {
        return ctx.effect(() => {
          const locale = ctx.get('locale');
          const t = locale.bind(LOCALE_NS);
          let completionRead;
          const disposeCompletion = ctx.effect(() => {
            completionRead = createCompletionReadBridge(
              ctx.get('uiSession')?.sessionStatus,
              (error) => console.error('[session-split] completion listener failed', error),
            );
            return () => completionRead.dispose();
          }, 'session-split completion read compatibility');
          const disposers = [
            locale.register(LOCALE_NS, 'en', EN),
            locale.register(LOCALE_NS, 'zh', ZH),
          ];
          const seat = ctx.inject(['sidebarRightTabs', 'sidebarRight'], (injected) => {
            const tabs = injected.get('sidebarRightTabs');
            const right = injected.get('sidebarRight');
            if (!tabs || !right) return undefined;
            const localDisposers = [];
            try {
              localDisposers.push(tabs.register({
                id: TAB_TYPE_ID,
                kind: TAB_KIND,
                keepMounted: true,
                patterns: [`${ADDRESS_PREFIX}**`],
                priority: 'extension',
                canOpen: (address) => parseSessionAddress(address) !== undefined,
                title: (address) => titleFor(address, ctx.sessions, t),
              }));
              localDisposers.push(ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
                name: 'sidebar.right.pane.tab',
                key: TAB_TYPE_ID,
                locale: LOCALE_NS,
                children: {
                  'sessionSplit.conversation': { kind: 'single', scope: 'session' },
                },
                inject: () => ({ sessions: ctx.sessions, completionRead }),
              }, SessionSplitTab)));
              localDisposers.push(ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
                name: 'sidebar.right.pane.tab.title',
                key: TAB_TYPE_ID,
                locale: LOCALE_NS,
              }, SessionSplitTitle)));
              localDisposers.push(ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({
                name: 'sidebar.workspaces.session.menu.item',
                id: 'session-split-open-right-v11-read-v201',
                order: 100,
                label: () => t('openRight'),
                locale: LOCALE_NS,
                inject: () => ({ right, t }),
              }, OpenRightMenuItem)));
            } catch (error) {
              for (const dispose of localDisposers.reverse()) {
                try { dispose(); } catch {}
              }
              throw error;
            }
            return () => {
              for (const dispose of localDisposers.reverse()) {
                try { dispose(); } catch (error) { console.error('[session-split] cleanup failed', error); }
              }
            };
          });
          return async () => {
            await seat.dispose();
            await disposeCompletion();
            for (const dispose of disposers.reverse()) {
              try { dispose(); } catch {}
            }
          };
        }, 'session-split client');
      },
    };
  },
});
