import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { Provider as TooltipProvider } from "@radix-ui/react-tooltip";
import {
  definePluginApp,
  experimental_NewThreadComposer,
  ThreadChat,
  useBbContext,
  useComposerView,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { NewThreadRequest, PluginNewThreadPanelProps } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";

const NewThreadComposer = experimental_NewThreadComposer;
const SuppressIncognitoActionContext = createContext(false);

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

function PrivacyNotice({ children }: { children: ReactNode }) {
  return (
    <div className="border-b border-border bg-card px-4 py-3 text-sm text-muted-foreground">
      <div className="mx-auto flex w-full max-w-4xl items-start gap-3">
        <EyeOffIcon className="mt-0.5 size-4 shrink-0 text-foreground" />
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}

function IncognitoWorkspace({ projectId }: { projectId: string | null }) {
  const { threadId: routeThreadId } = useBbContext();
  const rpc = useRpc<typeof rpcContract>();
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
        <PrivacyNotice>
          <p className="font-medium text-foreground">Incognito session</p>
          <p>
            This conversation is removed when you switch chats or close this incognito view.
            Workspace changes and provider-side data are not undone.
          </p>
        </PrivacyNotice>
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
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <PrivacyNotice>
          <p className="font-medium text-foreground">Start an incognito chat</p>
          <p>
            The temporary thread is hidden from your sidebar and deleted when you switch chats or
            close this incognito view. Changes made by an agent in your workspace remain.
        </p>
      </PrivacyNotice>
      <div className="mx-auto box-border w-full max-w-4xl flex-1 px-4 py-5 md:px-6 md:py-8">
        {error === null ? null : (
          <p role="alert" className="mb-4 rounded-md border border-destructive/40 p-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <SuppressIncognitoActionContext.Provider value={true}>
          <NewThreadComposer
            defaultProjectId={projectId ?? undefined}
            onSubmit={createSession}
            layout="contained"
            placeholder="What would you like to work on privately?"
            draftKey="hmm-incognito-draft"
          />
        </SuppressIncognitoActionContext.Provider>
        {creating ? (
          <p className="mt-3 text-center text-xs text-muted-foreground">Creating secure session…</p>
        ) : null}
      </div>
    </div>
  );
}

function IncognitoPanel({ projectId }: PluginNewThreadPanelProps) {
  return <IncognitoWorkspace projectId={projectId} />;
}

function IncognitoDialog({ projectId, onClose }: { projectId: string | null; onClose: () => void }) {
  return (
    // The app-overlay boundary has no TooltipProvider; the host composer's
    // tooltips crash the slot without one.
    <TooltipProvider>
      <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-16 md:pt-24" role="dialog" aria-modal="true" aria-label="Incognito chat">
      <button
        type="button"
        aria-label="Close incognito chat"
        className="absolute inset-0 cursor-default bg-background/80 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <section className="relative z-10 flex h-[min(720px,calc(100vh-8rem))] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
        <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <EyeOffIcon className="size-4 shrink-0 text-foreground" />
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-foreground">Incognito chat</h2>
              <p className="truncate text-xs text-muted-foreground">Deleted when you switch chats or close this view</p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close incognito chat"
            title="Close incognito chat"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>
        <div className="min-h-0 flex-1">
          <IncognitoWorkspace projectId={projectId} />
        </div>
        </section>
      </div>
    </TooltipProvider>
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
      aria-label="Open incognito chat"
      aria-expanded={isOpen}
      title="Open incognito chat"
      className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => setOverlayState({ projectId })}
    >
      <EyeOffIcon />
    </button>
  );
}

function IncognitoOverlay() {
  const session = useOverlayState();
  const { threadId: routeThreadId } = useBbContext();
  const routeThreadIdRef = useRef(routeThreadId);

  useEffect(() => {
    if (routeThreadIdRef.current === routeThreadId) return;
    routeThreadIdRef.current = routeThreadId;
    setOverlayState(null);
  }, [routeThreadId]);

  useEffect(() => {
    if (session === null) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") setOverlayState(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [session]);

  if (session === null) return null;
  return <IncognitoDialog projectId={session.projectId} onClose={() => setOverlayState(null)} />;
}

export default definePluginApp((app) => {
  app.composer.customize({
    id: "incognito-composer",
    scopes: ["new-thread"],
    actions: [{ id: "open-incognito", component: IncognitoComposerAction }],
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
