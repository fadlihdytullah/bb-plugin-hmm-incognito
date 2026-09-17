import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Provider as TooltipProvider } from "@radix-ui/react-tooltip";
import {
  definePluginApp,
  experimental_NewThreadComposer,
  experimental_ProviderModelPicker,
  experimental_useProviders,
  ThreadChat,
  useBbContext,
  useComposerView,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type {
  ExperimentalProviderModelPickerValue,
  NewThreadRequest,
  PluginNewThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";

const NewThreadComposer = experimental_NewThreadComposer;
const ProviderModelPicker = experimental_ProviderModelPicker;
const SuppressIncognitoActionContext = createContext(false);
const TOGGLE_EVENT = "hmm-incognito:toggle";

const SHORTCUT_HINT =
  typeof navigator !== "undefined" && /mac/i.test(navigator.platform ?? "")
    ? "⌘⌥N"
    : "Ctrl+Alt+N";

// The composer action stays on the root New Thread composer. The global
// shortcut is handled by a capture-phase content script so BB's own shortcuts
// cannot consume it first, then forwarded to the app-wide floating overlay.
function isIncognitoShortcut(event: KeyboardEvent): boolean {
  return (
    !event.repeat &&
    event.code === "KeyN" &&
    (event.metaKey || event.ctrlKey) &&
    event.altKey &&
    !event.shiftKey
  );
}

function mountShortcutListener(): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!isIncognitoShortcut(event)) return;
    event.preventDefault();
    event.stopPropagation();
    window.dispatchEvent(new CustomEvent(TOGGLE_EVENT));
  };

  window.addEventListener("keydown", onKeyDown, { capture: true });
  return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
}

// The composer action slot sits inside bb's promptbox, which declares
// `container-type: inline-size`. That makes it the containing block for
// `position: fixed` descendants, so a dialog rendered from the action is sized
// and clipped to the action strip instead of the viewport. App overlays are the
// SDK surface for app-wide floating UI, so the dialog lives there and the action
// only flips this store.
type IncognitoOverlayState = { projectId: string | null } | null;

let overlayState: IncognitoOverlayState = null;
const overlayListeners = new Set<() => void>();

function setOverlayState(next: IncognitoOverlayState): void {
  overlayState = next;
  for (const listener of overlayListeners) listener();
}

function useOverlayState(): IncognitoOverlayState {
  return useSyncExternalStore(
    (listener) => {
      overlayListeners.add(listener);
      return () => overlayListeners.delete(listener);
    },
    () => overlayState,
    () => overlayState,
  );
}

function EyeOffIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 3l18 18" />
      <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
      <path d="M9.9 4.2A10.7 10.7 0 0 1 12 4c5 0 8.7 4.4 9.8 6a2 2 0 0 1 0 2 16.3 16.3 0 0 1-4.2 4.3" />
      <path d="M6.6 6.6A16 16 0 0 0 2.2 10a2 2 0 0 0 0 2C3.5 13.7 7.3 18 12 18c1 0 2-.2 2.9-.5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function PrivacyNotice({
  onClose,
  titleId,
}: {
  onClose?: () => void;
  titleId?: string;
}) {
  return (
    <header className="shrink-0 border-b border-border bg-card/50 px-3 py-2 md:px-4">
      <div className="mx-auto flex w-full max-w-4xl items-start gap-2">
        <EyeOffIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-sm font-medium text-foreground">
            Incognito chat
          </h2>
          <p className="text-xs leading-4 text-muted-foreground">
            Temporary chat · deleted when you leave
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground sm:inline-block">
            {SHORTCUT_HINT}
          </kbd>
          {onClose === undefined ? null : (
            <button
              type="button"
              aria-label="Close incognito chat"
              title="Close incognito chat"
              className="-mr-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={onClose}
            >
              <CloseIcon />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

type IncognitoExecution = ExperimentalProviderModelPickerValue;

// Resolves once per mount. The composer treats `default*` as re-seedable props,
// so arriving a tick after mount simply re-seeds the pickers.
function useIncognitoDefaults(): IncognitoExecution | null {
  const rpc = useRpc<typeof rpcContract>();
  const [defaults, setDefaults] = useState<IncognitoExecution | null>(null);

  useEffect(() => {
    let active = true;
    void rpc
      .call("defaults_get", {})
      .then((result) => {
        if (active) setDefaults(result.defaults);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [rpc]);

  return defaults;
}

function IncognitoWorkspace({
  projectId,
  onClose,
  titleId,
}: {
  projectId: string | null;
  onClose?: () => void;
  titleId?: string;
}) {
  const { threadId: routeThreadId } = useBbContext();
  const rpc = useRpc<typeof rpcContract>();
  const defaults = useIncognitoDefaults();
  const [threadId, setThreadId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentThreadRef = useRef<string | null>(null);
  const rpcRef = useRef(rpc);
  const mountedRef = useRef(true);
  const routeThreadIdRef = useRef(routeThreadId);
  const routeVersionRef = useRef(0);
  rpcRef.current = rpc;

  function closeActiveSession(): void {
    const activeThreadId = currentThreadRef.current;
    if (activeThreadId === null) return;
    currentThreadRef.current = null;
    void rpcRef.current.call("session_close", { threadId: activeThreadId }).catch(() => undefined);
  }

  useEffect(() => {
    currentThreadRef.current = threadId;
  }, [threadId]);

  useEffect(() => {
    if (routeThreadIdRef.current === routeThreadId) return;
    routeThreadIdRef.current = routeThreadId;
    routeVersionRef.current += 1;
    closeActiveSession();
    setThreadId(null);
  }, [routeThreadId]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      closeActiveSession();
    };
  }, []);

  useEffect(() => {
    if (threadId === null) return;
    const heartbeat = window.setInterval(() => {
      void rpc.call("session_heartbeat", { threadId }).catch(() => undefined);
    }, 15_000);
    return () => window.clearInterval(heartbeat);
  }, [rpc, threadId]);

  async function createSession(request: NewThreadRequest): Promise<void> {
    if (creating) return;
    const routeVersion = routeVersionRef.current;
    setCreating(true);
    setError(null);
    try {
      const result = await rpc.call("session_create", { request });
      if (!mountedRef.current || routeVersion !== routeVersionRef.current) {
        void rpc.call("session_close", { threadId: result.threadId }).catch(() => undefined);
        return;
      }
      currentThreadRef.current = result.threadId;
      setThreadId(result.threadId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setCreating(false);
    }
  }

  if (threadId !== null) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <PrivacyNotice onClose={onClose} titleId={titleId} />
        <div className="min-h-0 flex-1">
          <ThreadChat
            threadId={threadId}
            variant="full"
            layout="contained"
            permissionPolicy="editable"
            className="h-full"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PrivacyNotice onClose={onClose} titleId={titleId} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full flex-col justify-end px-4 py-4 md:px-6 md:py-6">
          <div className="w-full">
            {error === null ? null : (
              <div
                role="alert"
                className="mb-4 rounded-lg border border-destructive/40 px-4 py-3 text-sm text-destructive"
              >
                <p className="font-medium">Couldn&apos;t start the incognito chat.</p>
                <p className="mt-0.5 text-xs">{error} Try again.</p>
              </div>
            )}
            <SuppressIncognitoActionContext.Provider value={true}>
              <NewThreadComposer
                defaultProjectId={projectId ?? undefined}
                defaultProviderId={defaults?.providerId}
                defaultModel={defaults?.model}
                defaultReasoningLevel={defaults?.reasoningLevel}
                defaultServiceTier={defaults?.serviceTier}
                onSubmit={createSession}
                layout="contained"
                className="w-full"
                placeholder="What would you like to work on privately?"
                draftKey="hmm-incognito-draft"
              />
            </SuppressIncognitoActionContext.Provider>
            {creating ? (
              <p aria-live="polite" className="mt-3 text-center text-xs text-muted-foreground">
                Starting incognito chat…
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

// Rendered on the plugin's Tools detail page. The model is stored as this
// plugin's own preference instead of a declarative setting because a model id
// is only meaningful against the live provider catalog the picker reads.
function IncognitoDefaultsSection() {
  const rpc = useRpc<typeof rpcContract>();
  const { providers } = experimental_useProviders();
  const [state, setState] = useState<{
    defaults: IncognitoExecution | null;
    lastUsed: IncognitoExecution | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void rpc.call("defaults_get", {}).then(
      (result) => {
        if (active) setState({ defaults: result.defaults, lastUsed: result.lastUsed });
      },
      (cause: unknown) => {
        if (!active) return;
        setState({ defaults: null, lastUsed: null });
        setError(cause instanceof Error ? cause.message : String(cause));
      },
    );
    return () => {
      active = false;
    };
  }, [rpc]);

  async function save(next: IncognitoExecution | null): Promise<void> {
    // A provider switch can emit before the live catalog resolves a model.
    if (next !== null && next.model === "") return;
    setState((prev) => (prev === null ? prev : { ...prev, defaults: next }));
    setError(null);
    try {
      await rpc.call("defaults_set", { defaults: next });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  if (state === null) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const stored = state.defaults ?? state.lastUsed;
  const fallbackProvider = providers.find((provider) => provider.available) ?? providers[0];
  if (stored === null && fallbackProvider === undefined) {
    return <p className="text-sm text-muted-foreground">No agent providers are available yet.</p>;
  }

  const value: IncognitoExecution = stored ?? {
    providerId: fallbackProvider?.id ?? "",
    model: "",
    reasoningLevel: (fallbackProvider?.reasoningLevels?.[0]?.id ??
      "medium") as IncognitoExecution["reasoningLevel"],
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <ProviderModelPicker value={value} onChange={(next) => void save(next)} />
        {state.defaults === null ? null : (
          <button
            type="button"
            className="inline-flex h-8 items-center rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => void save(null)}
          >
            Reset to BB default
          </button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {state.defaults === null
          ? "Not set — incognito chats start with BB's own default provider and model."
          : "New incognito chats start with this provider and model."}
      </p>
      {error === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function IncognitoPanel({ projectId }: PluginNewThreadPanelProps) {
  return <IncognitoWorkspace projectId={projectId} />;
}

function IncognitoDialog({ projectId, onClose }: { projectId: string | null; onClose: () => void }) {
  const overlayHost =
    typeof document === "undefined"
      ? null
      : document.querySelector<HTMLElement>('main[data-sidebar="inset"]') ?? document.body;

  if (overlayHost === null) return null;

  return createPortal(
    // The app-overlay boundary has no TooltipProvider; the host composer's
    // tooltips crash the slot without one.
    <TooltipProvider>
      <div data-bb-plugin="hmm-incognito" style={{ display: "contents" }}>
        <div
          className="absolute inset-0 z-50 flex items-center justify-center p-2 sm:p-3 md:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="incognito-dialog-title"
        >
          <button
            type="button"
            aria-label="Close incognito chat"
            className="absolute inset-0 cursor-default bg-background/85 backdrop-blur-md"
            onClick={onClose}
          />
          <section className="relative z-10 flex min-h-0 h-[min(900px,calc(100vh-1rem))] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-background sm:h-[min(900px,calc(100vh-1.5rem))] md:h-[min(900px,calc(100vh-2rem))]">
            <div className="h-full min-h-0 flex-1">
              <IncognitoWorkspace
                projectId={projectId}
                onClose={onClose}
                titleId="incognito-dialog-title"
              />
            </div>
          </section>
        </div>
      </div>
    </TooltipProvider>,
    overlayHost,
  );
}

function IncognitoComposerAction() {
  const view = useComposerView();
  const isIncognitoComposer = useContext(SuppressIncognitoActionContext);
  const isOpen = useOverlayState() !== null;

  if (isIncognitoComposer || view.scope.kind !== "new-thread") return null;
  const projectId = view.scope.projectId;

  return (
    <button
      type="button"
      aria-label={`Open incognito chat (${SHORTCUT_HINT})`}
      aria-expanded={isOpen}
      aria-keyshortcuts={SHORTCUT_HINT.startsWith("⌘") ? "Meta+Alt+N" : "Control+Alt+N"}
      title={`Open incognito chat (${SHORTCUT_HINT})`}
      className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => setOverlayState({ projectId })}
    >
      <EyeOffIcon />
    </button>
  );
}

function IncognitoOverlay() {
  const session = useOverlayState();
  const { threadId: routeThreadId, projectId } = useBbContext();
  const routeThreadIdRef = useRef(routeThreadId);

  useEffect(() => {
    if (routeThreadIdRef.current === routeThreadId) return;
    routeThreadIdRef.current = routeThreadId;
    setOverlayState(null);
  }, [routeThreadId]);

  useEffect(() => {
    function onToggle(): void {
      setOverlayState(session === null ? { projectId } : null);
    }
    window.addEventListener(TOGGLE_EVENT, onToggle);
    return () => window.removeEventListener(TOGGLE_EVENT, onToggle);
  }, [projectId, session]);

  if (session === null) return null;
  return <IncognitoDialog projectId={session.projectId} onClose={() => setOverlayState(null)} />;
}

export default definePluginApp((app) => {
  app.contentScripts.register({
    id: "incognito-shortcut",
    mount: () => mountShortcutListener(),
  });

  app.composer.customize({
    id: "incognito-composer",
    scopes: ["new-thread"],
    actions: [{ id: "open-incognito", component: IncognitoComposerAction }],
  });

  app.slots.settingsSection({
    id: "incognito-defaults",
    title: "Default model",
    description: "Provider and model new incognito chats start with.",
    component: IncognitoDefaultsSection,
  });

  app.slots.experimental_appOverlay({
    id: "incognito-overlay",
    component: IncognitoOverlay,
  });

  app.slots.experimental_newThreadPanelAction({
    id: "incognito-chat",
    title: "Incognito chat",
    icon: "EyeOff",
    component: IncognitoPanel,
    layout: "flush",
  });
});
