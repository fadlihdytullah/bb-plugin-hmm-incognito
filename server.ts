import { defineRpcContract, type BbPluginApi, type NewThreadRequest } from "@get-bb/plugin-sdk";
import { z } from "zod";

const SESSION_KEY = "active-sessions";
const SESSION_TTL_MS = 60_000;
const SWEEP_INTERVAL_MS = 15_000;

const permissionModeSchema = z.enum(["accept-edits", "auto", "full", "workspace-write"]);
const reasoningLevelSchema = z.enum([
  "high",
  "low",
  "max",
  "medium",
  "none",
  "ultra",
  "ultracode",
  "xhigh",
]);
const serviceTierSchema = z.enum(["default", "fast"]);

const branchSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("existing"), name: z.string().min(1) }),
  z.object({ kind: z.literal("new"), baseBranch: z.string().min(1) }),
]);

const workspaceSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("unmanaged"),
    path: z.string().nullable(),
    branch: branchSchema.optional(),
  }),
  z.object({
    type: z.literal("managed-worktree"),
    baseBranch: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("named"), name: z.string().min(1) }),
      z.object({ kind: z.literal("default") }),
    ]),
  }),
  z.object({ type: z.literal("personal") }),
]);

const environmentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("project-default") }),
  z.object({ type: z.literal("reuse"), environmentId: z.string().min(1) }),
  z.object({
    type: z.literal("host"),
    hostId: z.string().min(1).optional(),
    workspace: workspaceSchema,
  }),
]);

const mentionResourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("thread"),
    label: z.string(),
    projectId: z.string().optional(),
    threadId: z.string().min(1),
  }),
  z.object({ kind: z.literal("project"), label: z.string(), projectId: z.string().min(1) }),
  z.object({ kind: z.literal("section"), label: z.string(), sectionId: z.string().min(1) }),
  z.object({
    kind: z.literal("path"),
    label: z.string(),
    path: z.string(),
    source: z.enum(["thread-storage", "workspace"]),
    entryKind: z.enum(["directory", "file"]),
  }),
  z.object({
    kind: z.literal("command"),
    label: z.string(),
    name: z.string(),
    argumentHint: z.string().nullable(),
    origin: z.enum(["builtin", "project", "user"]),
    source: z.enum(["command", "skill"]),
    trigger: z.literal("/"),
  }),
  z.object({
    kind: z.literal("plugin"),
    label: z.string(),
    itemId: z.string(),
    pluginId: z.string(),
    icon: z.string().nullable().optional(),
  }),
]);

const mentionSchema = z.object({
  start: z.number().finite(),
  end: z.number().finite(),
  resource: mentionResourceSchema,
});

const promptInputSchema = z.array(
  z.discriminatedUnion("type", [
    z.object({
      type: z.literal("text"),
      text: z.string(),
      mentions: z.array(mentionSchema).default([]),
      visibility: z.literal("agent-only").optional(),
    }),
    z.object({
      type: z.literal("image"),
      url: z.string(),
      visibility: z.literal("agent-only").optional(),
    }),
    z.object({
      type: z.literal("localImage"),
      path: z.string(),
      visibility: z.literal("agent-only").optional(),
    }),
    z.object({
      type: z.literal("localFile"),
      path: z.string(),
      mimeType: z.string().optional(),
      name: z.string().optional(),
      sizeBytes: z.number().finite().optional(),
      visibility: z.literal("agent-only").optional(),
    }),
  ]),
).min(1).max(128);

const newThreadRequestSchema = z
  .object({
    projectId: z.string().min(1),
    providerId: z.string().min(1),
    model: z.string().min(1),
    reasoningLevel: reasoningLevelSchema,
    permissionMode: permissionModeSchema,
    serviceTier: serviceTierSchema.optional(),
    executionInputSources: z
      .object({
        model: z.enum(["client-preference", "explicit"]).optional(),
        permissionMode: z.enum(["client-preference", "explicit"]).optional(),
        providerId: z.enum(["client-preference", "explicit"]).optional(),
        reasoningLevel: z.enum(["client-preference", "explicit"]).optional(),
        serviceTier: z.enum(["client-preference", "explicit"]).optional(),
      })
      .default({}),
    environment: environmentSchema,
    input: promptInputSchema,
    sendAt: z.number().finite().int().nonnegative().optional(),
  })
  .transform((request) => request as NewThreadRequest);

const sessionSchema = z.object({
  threadId: z.string().min(1),
  updatedAt: z.number().finite().int().nonnegative(),
});

const rpcContract = defineRpcContract({
  session_create: {
    input: z.object({ request: newThreadRequestSchema }),
    output: z.object({ threadId: z.string() }),
  },
  session_heartbeat: {
    input: z.object({ threadId: z.string().min(1) }),
    output: z.object({ ok: z.literal(true) }),
  },
  session_close: {
    input: z.object({ threadId: z.string().min(1) }),
    output: z.object({ removed: z.boolean() }),
  },
});

type IncognitoSession = z.infer<typeof sessionSchema>;

function isMissingThreadError(error: unknown): boolean {
  const message = String(error).toLowerCase();
  return message.includes("thread not found") || message.includes("thread_not_found");
}

async function abortableDelay(signal: AbortSignal, milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export default async function plugin(bb: BbPluginApi) {
  const stored = await bb.storage.kv.get<unknown>(SESSION_KEY);
  const parsedSessions = z.array(sessionSchema).safeParse(stored);
  let sessions: IncognitoSession[] = parsedSessions.success ? parsedSessions.data : [];

  async function persistSessions(): Promise<void> {
    await bb.storage.kv.set(SESSION_KEY, sessions);
  }

  async function deleteThread(threadId: string): Promise<boolean> {
    try {
      await bb.sdk.threads.stop({ threadId });
    } catch (error) {
      bb.log.debug(`incognito stop skipped for ${threadId}: ${String(error)}`);
    }

    try {
      await bb.sdk.threads.delete({ threadId, childThreadsConfirmed: true });
      return true;
    } catch (error) {
      // A second cleanup attempt may race with a user deletion or a previous
      // successful delete. Treat a missing thread as already cleaned up.
      try {
        const current = await bb.sdk.threads.get({ threadId });
        if (current.deletedAt !== null) return true;
      } catch (lookupError) {
        if (isMissingThreadError(lookupError)) return true;
      }
      bb.log.warn(`incognito thread cleanup failed for ${threadId}: ${String(error)}`);
      return false;
    }
  }

  async function removeSession(threadId: string): Promise<boolean> {
    const exists = sessions.some((session) => session.threadId === threadId);
    if (!exists) return false;
    if (!(await deleteThread(threadId))) return false;
    sessions = sessions.filter((session) => session.threadId !== threadId);
    await persistSessions();
    return true;
  }

  async function sweepExpiredSessions(): Promise<void> {
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const session of [...sessions]) {
      if (session.updatedAt < cutoff) await removeSession(session.threadId);
    }
  }

  async function enforceHiddenVisibility(threadId: string): Promise<void> {
    try {
      const thread = await bb.sdk.threads.get({ threadId });
      if (thread.visibility === "hidden") return;
      await bb.sdk.threads.update({ threadId, visibility: "hidden" });
    } catch (error) {
      bb.log.warn(`incognito visibility guard failed for ${threadId}: ${String(error)}`);
    }
  }

  await sweepExpiredSessions();
  await persistSessions();

  bb.events.on("thread.created", ({ thread }) => {
    if (thread.originPluginId !== bb.pluginId || thread.visibility === "hidden") return;
    void enforceHiddenVisibility(thread.id);
  });

  bb.rpc.register(rpcContract, {
    session_create: async ({ request }) => {
      const thread = await bb.sdk.threads.spawn({
        ...request,
        origin: "plugin",
        title: "Incognito chat",
        visibility: "hidden",
      });
      await enforceHiddenVisibility(thread.id);
      const session = { threadId: thread.id, updatedAt: Date.now() } satisfies IncognitoSession;
      sessions = [...sessions, session];
      try {
        await persistSessions();
      } catch (error) {
        await deleteThread(thread.id);
        throw error;
      }
      return { threadId: thread.id };
    },
    session_heartbeat: async ({ threadId }) => {
      const index = sessions.findIndex((session) => session.threadId === threadId);
      if (index < 0) throw new Error("Incognito session is no longer available");
      sessions[index] = { threadId, updatedAt: Date.now() };
      await persistSessions();
      return { ok: true } as const;
    },
    session_close: async ({ threadId }) => ({ removed: await removeSession(threadId) }),
  });

  bb.background.service("incognito-cleanup", {
    async start(signal) {
      while (!signal.aborted) {
        await abortableDelay(signal, SWEEP_INTERVAL_MS);
        if (!signal.aborted) await sweepExpiredSessions();
      }
    },
  });

  bb.onDispose(async () => {
    for (const session of [...sessions]) await removeSession(session.threadId);
  });
}

export type { IncognitoSession };
export { rpcContract };
