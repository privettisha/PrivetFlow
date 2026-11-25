'use strict';
const MATCH = 'https://flow.google.com/*';
const registration = {id: 'privetflow-engine', matches: [MATCH], js: ['engine.js'], runAt: 'document_start', world: 'MAIN', persistAcrossSessions: true};
let queue = Promise.resolve();
function serialize(fn) {
  const next = queue.then(fn);
  queue = next.catch(() => {});
  return next;
}
async function reconcile() {
  const {enabled = true} = await chrome.storage.local.get('enabled');
  const existing = await chrome.scripting.getRegisteredContentScripts({ids: [registration.id]});
  if (enabled && !existing.length) await chrome.scripting.registerContentScripts([registration]);
  if (enabled && existing.length) await chrome.scripting.updateContentScripts([registration]);
  if (!enabled && existing.length) await chrome.scripting.unregisterContentScripts({ids: [registration.id]});
  await chrome.action.setBadgeText({text: enabled ? '' : 'OFF'});
  return enabled;
}
chrome.runtime.onInstalled.addListener(() => serialize(reconcile));
chrome.runtime.onStartup.addListener(() => serialize(reconcile));
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup.html')) return;
  serialize(async () => {
    if (message.action === 'toggle') {
      if (typeof message.enabled !== 'boolean') throw new Error('Invalid setting');
      const previous = await chrome.storage.local.get('enabled');
      await chrome.storage.local.set({enabled: message.enabled});
      try { await reconcile(); } catch (e) { await chrome.storage.local.set({enabled: previous.enabled ?? true}); await reconcile(); throw e; }
      const tabs = await chrome.tabs.query({url: MATCH});
      const reloads = await Promise.allSettled(tabs.map(t => chrome.tabs.reload(t.id)));
      return {enabled: message.enabled, failedReloads: reloads.filter(r => r.status === 'rejected').length};
    }
    if (message.action === 'open') {
      const tabs = await chrome.tabs.query({url: MATCH});
      const tab = tabs.find(t => t.active) || tabs[0];
      if (tab) { await chrome.tabs.update(tab.id, {active: true}); await chrome.windows.update(tab.windowId, {focused: true}); }
      else await chrome.tabs.create({url: 'https://flow.google.com/'});
      return {};
    }
    if (message.action === 'status') {
      const enabled = await reconcile();
      const tabs = await chrome.tabs.query({url: MATCH, currentWindow: true});
      const tab = tabs.find(t => t.active) || tabs[0];
      let diagnostic = null;
      if (tab) {
        try {
          const [result] = await chrome.scripting.executeScript({target: {tabId: tab.id}, world: 'MAIN', func: () => {
            const d = window.__privetFlow;
            return d ? {state: d.state, changed: d.changed, recognized: d.recognized, errors: d.errors} : null;
          }});
          const d = result.result;
          if (d && typeof d === 'object') {
            const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
            diagnostic = {state: ['waiting', 'applied', 'available', 'restricted', 'unknown'].includes(d.state) ? d.state : 'unknown', changed: count(d.changed), recognized: count(d.recognized), errors: count(d.errors)};
          }
        } catch { /* A navigating tab may not yet be accessible. */ }
      }
      return {enabled, tabId: tab?.id, diagnostic};
    }
    if (message.action === 'reload') {
      const tabs = await chrome.tabs.query({url: MATCH, currentWindow: true});
      const tab = tabs.find(t => t.active) || tabs[0];
      if (tab) await chrome.tabs.reload(tab.id);
      return {};
    }
    throw new Error('Unknown action');
  }).then(result => respond({ok: true, ...result}), () => respond({ok: false, error: 'Не удалось выполнить действие. Перезагрузите расширение.'}));
  return true;
});
