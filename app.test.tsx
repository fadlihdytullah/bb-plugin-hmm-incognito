import { describe, expect, it } from "vitest";
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));

describe("Hmm Incognito app", () => {
  it("keeps the Eye off action on the primary new-thread composer", () => {
    expect(app.composerCustomizations).toHaveLength(1);
    expect(app.composerCustomizations[0]).toMatchObject({
      id: "incognito-composer",
      scopes: ["new-thread"],
      actions: [{ id: "open-incognito" }],
    });
  });

  it("registers the floating overlay and global shortcut content script", () => {
    expect(app.appOverlays).toHaveLength(1);
    expect(app.appOverlays[0]).toMatchObject({ id: "incognito-overlay" });
    expect(app.contentScripts).toMatchObject([{ id: "incognito-shortcut" }]);
  });

  it("does not add Incognito chat to existing-thread sidebar actions", () => {
    expect(app.threadPanelActions).toHaveLength(0);
  });

  it("keeps the Incognito chat fallback on the New Thread panel", () => {
    expect(app.newThreadPanelActions).toHaveLength(1);
    expect(app.newThreadPanelActions[0]).toMatchObject({
      id: "incognito-chat",
      title: "Incognito chat",
      icon: "EyeOff",
      layout: "flush",
    });
  });
});
