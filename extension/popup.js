'use strict';
const $ = id => document.getElementById(id);
let snapshot = null, busy = false;
async function send(action, extra = {}) {
  const result = await chrome.runtime.sendMessage({action, ...extra});
  if (!result?.ok) throw new Error(result?.error || 'Расширение не отвечает. Перезагрузите его.');
  return result;
}
const states = {
  waiting: ['Ожидаем ответ Flow', 'Откройте Flow и дождитесь загрузки страницы.'],
  applied: ['Региональный флаг изменён', 'Изменение применено локально. Генерация зависит от Google и аккаунта.'],
  available: ['Регион уже доступен', 'Flow вернул разрешённый региональный флаг.'],
  restricted: ['Есть другое ограничение', 'Проверьте требования аккаунта в Google Flow.'],
  unknown: ['Формат ответа не распознан', 'Данные сохранены без изменений. Проверьте обновления PrivetFlow.']
};
async function refresh() {
  snapshot = await send('status');
  $('enabled').checked = snapshot.enabled;
  $('enabled').disabled = false;
  $('reload').disabled = !snapshot.tabId;
  const state = !snapshot.enabled ? ['Помощник выключен', 'Включите его, чтобы обработать региональные проверки.'] :
    !snapshot.tabId ? ['Откройте Google Flow', 'Помощник готов. Начните с кнопки ниже.'] :
    !snapshot.diagnostic ? ['Обновите вкладку Flow', 'Помощник подключится при следующей загрузке страницы.'] :
    states[snapshot.diagnostic.state] || states.unknown;
  $('state-title').textContent = state[0]; $('state-detail').textContent = state[1];
  $('state-icon').textContent = snapshot.enabled && snapshot.diagnostic?.state === 'applied' ? '✓' : '◌';
}
async function act(fn) {
  if (busy) return;
  busy = true; $('notice').textContent = '';
  try { await fn(); await refresh(); } catch (e) { $('notice').textContent = e.message; }
  finally { busy = false; }
}
$('enabled').addEventListener('change', () => act(async () => {
  $('enabled').disabled = true;
  try {
    const result = await send('toggle', {enabled: $('enabled').checked});
    if (result.failedReloads) $('notice').textContent = 'Обновите вкладки Flow вручную.';
  } finally { $('enabled').disabled = false; }
}));
$('open').addEventListener('click', () => act(() => send('open')));
$('reload').addEventListener('click', () => act(() => send('reload')));
$('copy').addEventListener('click', () => act(async () => {
  await refresh();
  const report = {product: 'PrivetFlow', version: chrome.runtime.getManifest().version, enabled: snapshot.enabled, flowTabOpen: Boolean(snapshot.tabId), diagnostic: snapshot.diagnostic};
  await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
  $('notice').textContent = 'Отчёт скопирован. Личных данных в нём нет.';
}));
refresh().catch(e => { $('state-title').textContent = 'Не удалось прочитать настройки'; $('state-detail').textContent = e.message; });
setInterval(() => { if (!busy) refresh().catch(() => {}); }, 2000);
