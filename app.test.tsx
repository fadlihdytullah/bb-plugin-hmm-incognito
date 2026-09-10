import { describe, expect, it } from "vitest";
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));

describe("Hmm Incognito app", () => {
  it("adds a visible action to the primary new-thread composer", () => {
    expect(app.composerCustomizations).toHaveLength(1);
    expect(app.composerCustomizations[0]).toMatchObject({
      id: "incognito-composer",
      scopes: ["new-thread"],
      actions: [{ id: "open-incognito" }],
    });
  });

  it("renders the incognito dialog from an app overlay, not the composer slot", () => {
    expect(app.appOverlays).toHaveLength(1);
    expect(app.appOverlays[0]).toMatchObject({ id: "incognito-overlay" });
  });

  it("registers the incognito action on the new-thread panel", () => {
    expect(app.newThreadPanelActions).toHaveLength(1);
    expect(app.newThreadPanelActions[0]).toMatchObject({
      id: "incognito-chat",
      title: "Incognito chat",
      icon: "EyeOff",
      layout: "flush",
    });
  });
});
