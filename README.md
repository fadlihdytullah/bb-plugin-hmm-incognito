# bb-plugin-hmm-incognito

Temporary, hidden chats for [bb](https://getbb.app). Hmm Incognito adds an
**Eye off** CTA to bb's primary New Thread composer. It opens an incognito chat
overlay using the normal bb composer and chat UI, then deletes the hidden
temporary thread as soon as you close that view or switch to another chat. The
overlay can also be toggled from anywhere with <kbd>⌘⌥N</kbd>
(<kbd>Ctrl+Alt+N</kbd> off macOS).

Sending from bb's ordinary New Thread composer still creates a normal visible
thread that stays in Personal/project lists, Activity, and recent history.

## Tech Stack

- TypeScript and React
- `@get-bb/plugin-sdk` for bb plugin registration and host chat components
- Zod for RPC and thread-request validation
- Vitest for backend and frontend contract tests

## Prerequisites

- bb >= 0.42
- Node.js and npm
- A local bb installation with plugin development commands available

## Setup

```sh
git clone git@github.com:fadlihdytullah/bb-plugin-hmm-incognito.git
cd bb-plugin-hmm-incognito
npm install
bb plugin types
```

## Environment

No environment variables are required.

## Run

```sh
npm test
bb plugin build
```

## Deploy

Install the published Git source with:

```sh
bb plugin install git:https://github.com/fadlihdytullah/bb-plugin-hmm-incognito
```

The plugin can also be installed from a local checkout while developing:

```sh
bb plugin install path:.
```

## How it works

- The **Eye off** action registers through `app.composer.customize` on the
  `new-thread` scope. It is not added to existing-thread composer actions.
- The **Incognito chat** entry remains available through
  `app.slots.experimental_newThreadPanelAction` on the New Thread screen. No
  `threadPanelAction` is registered for existing-thread sidebar Actions.
- The dialog itself renders from `app.slots.experimental_appOverlay`, not from
  the composer action slot. bb's promptbox declares
  `container-type: inline-size`, which makes it the containing block for
  `position: fixed` descendants — a dialog rendered inline there is sized and
  clipped to the action strip instead of the viewport. The overlay portals its
  content into bb's main chat inset, restores the plugin CSS scope at the portal
  root, and uses a blurred backdrop so the dialog is centered and sized against
  the chat container rather than across the entire application window. Its
  responsive surface grows to a maximum height of 640px while preserving
  viewport insets.
- A capture-phase content script recognizes <kbd>⌘⌥N</kbd> /
  <kbd>Ctrl+Alt+N</kbd> and forwards a toggle event to the app-wide overlay.
  The overlay resolves the active project through `useBbContext()`, so the
  shortcut opens the same floating chat from existing chats, New Thread, or a
  plugin page.
- The overlay keeps a compact header with a short retention summary. Before
  the first message, a pixel "incognito" wordmark (drawn in the same grid as
  the mercury theme's wordmark, tinted from `currentColor`) fills the empty
  space, centered and scaling down when the view is short. The composer uses
  the same content width as the modal, keeps equal horizontal insets, and stays
  anchored to the bottom edge.
- The composer forwards the complete environment selection to the server,
  including provider-managed environments, provider inputs, and machine
  selections, so the incognito thread uses the same workspace choice as the
  normal New Thread flow.
- A **Default model** section registers through `app.slots.settingsSection` and
  renders on the plugin's Tools detail page. It uses bb's own
  `experimental_ProviderModelPicker`, so the selection is validated against the
  live provider catalog instead of being typed as a raw model id. The stored
  value seeds the incognito composer's provider, model, reasoning level, and
  service tier; **Reset to BB default** clears it and returns the composer to
  bb's own defaults. Until a default is set, the picker opens on the execution
  the last incognito chat actually ran with.
- Submitting spawns the thread server-side with `visibility: "hidden"` and
  `title: "Incognito chat"`, then renders bb's standard `ThreadChat`, so
  streaming, tools, approvals, and provider controls behave normally.
- The frontend heartbeats the session every 15s. Closing the overlay, switching
  chats, or unmounting stops any active turn and deletes the thread. A
  background sweep removes sessions whose heartbeat went stale, covering
  reloads and crashes.

## Privacy boundary

This is temporary conversation cleanup, not a provider-side privacy mode:

- The thread exists in bb storage while the incognito view is open.
- `visibility: "hidden"` keeps the incognito thread out of Personal/project
  lists, Sidebar Activity, and recent history; it is not deletion or an
  access-control boundary.
- Prompts and attachments still go to the selected provider.
- Workspace edits, commands, and other agent side effects are not undone.
- If bb is interrupted, a heartbeat-based cleanup service removes stale sessions
  on its next pass.

## Development

Run `bb plugin dev` from this directory for an edit/reload loop. Use
`bb plugin types` after switching to a different bb SDK version so the
composer request contract stays aligned with the running bb host.
