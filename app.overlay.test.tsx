// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import {
  loadPluginApp,
  mountPluginContentScripts,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));

function pressShortcut(modifier: "meta" | "ctrl"): void {
  fireEvent.keyDown(window, {
    code: "KeyN",
    key: "n",
    altKey: true,
    metaKey: modifier === "meta",
    ctrlKey: modifier === "ctrl",
  });
}

describe("Hmm Incognito floating overlay shortcut", () => {
  it("toggles the floating overlay with both platform shortcuts", async () => {
    const chatContainer = document.createElement("main");
    chatContainer.dataset.sidebar = "inset";
    document.body.append(chatContainer);

    const slot = renderSlot(
      { component: app.appOverlays[0].component },
      {},
      { context: { projectId: "project-1", threadId: "thread-1" } },
    );
    const contentScripts = await mountPluginContentScripts(app, {
      pluginId: "hmm-incognito",
      generation: 1,
    });

    expect(slot.queryByRole("dialog")).toBeNull();

    pressShortcut("meta");
    expect(slot.getByRole("dialog")).toBeTruthy();
    expect(chatContainer.querySelector('[role="dialog"]')).toBeTruthy();
    expect(chatContainer.querySelector('[data-bb-plugin="hmm-incognito"]')).toBeTruthy();
    expect(chatContainer.querySelector("button.backdrop-blur-md")).toBeTruthy();

    pressShortcut("meta");
    expect(slot.queryByRole("dialog")).toBeNull();

    pressShortcut("ctrl");
    expect(slot.getByRole("dialog")).toBeTruthy();

    pressShortcut("ctrl");
    expect(slot.queryByRole("dialog")).toBeNull();

    slot.unmount();
    await contentScripts.lifecycle.dispose();
    chatContainer.remove();
  });

  it("keeps the chat surface visible after creating the hidden thread", async () => {
    const chatContainer = document.createElement("main");
    chatContainer.dataset.sidebar = "inset";
    document.body.append(chatContainer);

    const slot = renderSlot(
      { component: app.appOverlays[0].component },
      {},
      {
        context: { projectId: "project-1", threadId: "thread-1" },
        rpc: {
          session_create: () => ({ threadId: "incognito-thread-1" }),
        },
      },
    );
    const contentScripts = await mountPluginContentScripts(app, {
      pluginId: "hmm-incognito",
      generation: 1,
    });

    pressShortcut("meta");
    fireEvent.click(slot.getByTestId("bb-new-thread-composer-submit"));

    await waitFor(() => expect(slot.getByTestId("bb-thread-chat")).toBeTruthy());
    expect(chatContainer.querySelector('[role="dialog"]')).toBeTruthy();
    expect(chatContainer.querySelector('[data-thread-id="incognito-thread-1"]')).toBeTruthy();

    slot.unmount();
    await contentScripts.lifecycle.dispose();
    chatContainer.remove();
  });
});
