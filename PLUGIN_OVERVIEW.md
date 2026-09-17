Hmm Incognito gives bb a short-lived private workspace for conversations that
should not remain in the normal thread list.

Click the **Eye off** CTA in the primary New Thread composer (or choose
**Incognito chat** from the New Thread panel fallback). The overlay keeps the
same project, provider, model, environment, and permission settings available
in bb's normal composer—including provider-managed environment and machine
inputs—then creates a hidden thread and renders bb's standard `ThreadChat`
surface so streaming, tools, approvals, and provider controls behave normally.

Set a **Default model** on the plugin's page in Tools to choose the provider,
model, reasoning level, and service tier every new incognito chat starts with.
The picker reads bb's live provider catalog; **Reset to BB default** returns
incognito chats to bb's own defaults. You can still change the model per chat
in the composer.

The overlay uses a compact header with a short retention summary and a centered
pixel "incognito" wordmark until the first message is sent. Its composer
matches the modal's content width, keeps equal horizontal padding, and stays
anchored to the bottom of the view.

Switching to another chat or closing the incognito view stops any active turn
and deletes the temporary thread immediately. A server-side heartbeat and
cleanup pass cover browser disconnects and restarts.

The regular New Thread composer remains unchanged: a message sent there is a
normal visible bb thread. Only sessions opened through the Eye off CTA or the
Incognito chat panel action receive the hidden-list behavior.

Incognito does not make provider traffic disappear, and it cannot roll back
workspace changes or commands an agent already ran. It is designed for
conversation retention, not for undoing agent work.
