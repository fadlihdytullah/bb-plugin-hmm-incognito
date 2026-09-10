import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

const hosts: Array<ReturnType<typeof createFakePluginHost>> = [];

const request = {
  projectId: "project-1",
  providerId: "codex",
  model: "gpt-5",
  reasoningLevel: "medium" as const,
  permissionMode: "auto" as const,
  executionInputSources: {
    providerId: "explicit" as const,
    model: "explicit" as const,
    reasoningLevel: "explicit" as const,
    permissionMode: "explicit" as const,
  },
  environment: { type: "project-default" as const },
  input: [{ type: "text" as const, text: "Keep this temporary." }],
};

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.harness.lifecycle.dispose()));
});

function createHost(options: { spawnVisibility?: "hidden" | "visible"; getVisibility?: "hidden" | "visible" } = {}) {
  const spawnVisibility = options.spawnVisibility ?? "hidden";
  const getVisibility = options.getVisibility ?? spawnVisibility;
  const spawn = vi.fn(async () => makeThreadResponse({ id: "thread-incognito", visibility: spawnVisibility }));
  const stop = vi.fn(async () => ({ ok: true as const }));
  const remove = vi.fn(async () => ({ ok: true as const }));
  const update = vi.fn(async () => makeThreadResponse({ id: "thread-incognito", visibility: "hidden" }));
  const get = vi.fn(async ({ threadId }: { threadId: string }) =>
    makeThreadResponse({ id: threadId, visibility: getVisibility }),
  );
  const host = createFakePluginHost({
    pluginId: "bb-plugin-hmm-incognito",
    sdk: { threads: { spawn, stop, delete: remove, get, update } },
  });
  hosts.push(host);
  return { host, spawn, stop, remove, update };
}

describe("Hmm Incognito server", () => {
  it("creates a hidden attributed thread and removes it on close", async () => {
    const { host, spawn, stop, remove, update } = createHost();
    await plugin(host.bb);

    await expect(host.harness.callRpc("session_create", { request })).resolves.toEqual({
      threadId: "thread-incognito",
    });
    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Incognito chat",
        origin: "plugin",
        visibility: "hidden",
        projectId: "project-1",
      }),
    );
    expect(update).not.toHaveBeenCalled();

    await expect(
      host.harness.callRpc("session_heartbeat", { threadId: "thread-incognito" }),
    ).resolves.toEqual({ ok: true });
    await expect(
      host.harness.callRpc("session_close", { threadId: "thread-incognito" }),
    ).resolves.toEqual({ removed: true });
    expect(stop).toHaveBeenCalledWith({ threadId: "thread-incognito" });
    expect(remove).toHaveBeenCalledWith({
      threadId: "thread-incognito",
      childThreadsConfirmed: true,
    });
  });

  it("does not let an unknown thread id trigger deletion", async () => {
    const { host, remove } = createHost();
    await plugin(host.bb);

    await expect(
      host.harness.callRpc("session_close", { threadId: "not-an-incognito-session" }),
    ).resolves.toEqual({ removed: false });
    expect(remove).not.toHaveBeenCalled();
  });

  it("repairs a host response that does not retain hidden visibility", async () => {
    const { host, update } = createHost({ spawnVisibility: "visible" });
    await plugin(host.bb);

    await expect(host.harness.callRpc("session_create", { request })).resolves.toEqual({
      threadId: "thread-incognito",
    });
    expect(update).toHaveBeenCalledWith({
      threadId: "thread-incognito",
      visibility: "hidden",
    });
  });
});
