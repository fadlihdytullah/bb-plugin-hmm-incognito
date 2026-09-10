# bb-plugin-hmm-incognito

Temporary, hidden chats for [bb](https://getbb.app). Hmm Incognito adds an
**Eye off** CTA to bb's primary New Thread composer. It opens an incognito chat
overlay using the normal bb composer and chat UI, then deletes the hidden
temporary thread as soon as you close that view or switch to another chat. The
same action is also available from the New Thread panel as a fallback.

Sending from bb's ordinary New Thread composer still creates a normal visible
thread that stays in Personal/project lists, Activity, and recent history.

## Install

```sh
bb plugin install git:https://github.com/fadlihdytullah/bb-plugin-hmm-incognito
```

Requires bb >= 0.42.

## How it works

- The **Eye off** action registers through `app.composer.customize` on the
  `new-thread` scope; the **Incognito chat** entry registers through
  `app.slots.experimental_newThreadPanelAction`.
- The dialog itself renders from `app.slots.experimental_appOverlay`, not from
  the composer action slot. bb's promptbox declares
  `container-type: inline-size`, which makes it the containing block for
  `position: fixed` descendants — a dialog rendered inline there is sized and
  clipped to the action strip instead of the viewport.
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

```sh
npm install
bb plugin types
bb plugin build
bb plugin install .
npm test
```

For an edit/reload loop, run `bb plugin dev` from this directory.
