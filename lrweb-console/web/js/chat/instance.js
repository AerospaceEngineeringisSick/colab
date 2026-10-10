// Per-tab singleton chat client for the signed-in team member. Views import getChat(); it returns null
// when the console is running without personal accounts (secure chat needs a real identity).
import { api } from '../core/api.js';
import { state } from '../core/store.js';
import { createChatClient } from './session.js';
import { idbStorage } from './storage.js';

let client = null;
let forUser = null;

export function getChat() {
  const me = state.get('me');
  const user = me && !me.system && !me.local ? me : null;
  if (!user) return null;
  if (client && forUser === user.id) return client;
  client?.lock();
  // One IndexedDB per account so two people sharing a browser profile never share keys.
  client = createChatClient({ api, storage: idbStorage(`lrchat-${user.id}`), user: { id: user.id, name: user.name } });
  forUser = user.id;
  return client;
}

/** Called on sign-out: drop every in-memory secret. */
export function resetChat() {
  client?.lock();
  client = null;
  forUser = null;
}
