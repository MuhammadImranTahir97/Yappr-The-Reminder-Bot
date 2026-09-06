const todayList = document.getElementById('today-list');
const tomorrowList = document.getElementById('tomorrow-list');
const laterList = document.getElementById('later-list');
const doneList = document.getElementById('done-list');
const addForm = document.getElementById('add-form');
const notifBanner = document.getElementById('notif-banner');
const enableNotifBtn = document.getElementById('enable-notif');
const logoutBtn = document.getElementById('logout');
const recurringSelect = document.getElementById('recurring');
const everyNLabel = document.getElementById('every-n-label');
const everyNDaysInput = document.getElementById('everyNDays');
const titleInput = document.getElementById('title');
const notesInput = document.getElementById('notes');
const dueAtInput = document.getElementById('dueAt');
const nagMinutesInput = document.getElementById('nagMinutes');
const submitBtn = document.getElementById('submit-btn');
const cancelEditBtn = document.getElementById('cancel-edit');

const NAG_SEEN_KEY = 'nag-last-seen';
const lastSeenNag = JSON.parse(localStorage.getItem(NAG_SEEN_KEY) || '{}');

function saveLastSeenNag() {
  localStorage.setItem(NAG_SEEN_KEY, JSON.stringify(lastSeenNag));
}

function fmt(dt) {
  return new Date(dt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

function fmtTime(dt) {
  return new Date(dt).toLocaleString([], { timeStyle: 'short' });
}

function recurringLabel(recurring) {
  if (recurring === 'daily') return 'repeats daily';
  if (recurring === 'weekly') return 'repeats weekly';
  if (recurring === 'weekdays') return 'repeats weekdays';
  if (recurring && recurring.startsWith('every:')) return `repeats every ${recurring.slice(6)} days`;
  return null;
}

async function api(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 401) {
    window.location.href = '/login.html';
    return null;
  }
  if (!res.ok) throw new Error('request failed');
  return res.json();
}

let editingTaskId = null;

function startEdit(task) {
  editingTaskId = task.id;
  titleInput.value = task.title;
  notesInput.value = task.notes || '';

  const d = new Date(task.due_at);
  const pad = (n) => String(n).padStart(2, '0');
  dueAtInput.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

  if (task.recurring && task.recurring.startsWith('every:')) {
    recurringSelect.value = 'every';
    everyNDaysInput.value = task.recurring.slice(6);
  } else {
    recurringSelect.value = task.recurring || 'none';
  }
  everyNLabel.hidden = recurringSelect.value !== 'every';

  nagMinutesInput.value = task.nag_minutes;
  submitBtn.textContent = 'Save changes';
  cancelEditBtn.hidden = false;
  addForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cancelEdit() {
  editingTaskId = null;
  addForm.reset();
  nagMinutesInput.value = 15;
  everyNLabel.hidden = true;
  submitBtn.textContent = 'Add reminder';
  cancelEditBtn.hidden = true;
}

function renderTask(task) {
  const li = document.createElement('li');
  const now = Date.now();
  const overdue = !task.done && new Date(task.due_at).getTime() <= now;
  li.className = `task${task.done ? ' done' : ''}${overdue ? ' overdue' : ''}`;

  const main = document.createElement('div');
  main.className = 'task-main';

  const title = document.createElement('div');
  title.className = 'task-title';
  title.textContent = task.title;
  main.appendChild(title);

  if (task.notes) {
    const notes = document.createElement('div');
    notes.className = 'task-notes';
    notes.textContent = task.notes;
    main.appendChild(notes);
  }

  const meta = document.createElement('div');
  meta.className = 'task-meta';
  const parts = [`Due ${fmt(task.due_at)}`];
  const repeatLabel = recurringLabel(task.recurring);
  if (repeatLabel) parts.push(repeatLabel);
  if (!task.done) {
    parts.push(`nags every ${task.nag_minutes}m`);
    const nextNagAt = task.last_nagged_at
      ? new Date(task.last_nagged_at).getTime() + task.nag_minutes * 60 * 1000
      : new Date(task.due_at).getTime();
    parts.push(`next nag ${fmtTime(nextNagAt)}`);
  }
  meta.textContent = parts.join(' · ');
  main.appendChild(meta);

  li.appendChild(main);

  const actions = document.createElement('div');
  actions.className = 'task-actions';

  if (!task.done) {
    const doneBtn = document.createElement('button');
    doneBtn.className = 'done-btn';
    doneBtn.textContent = 'Done';
    doneBtn.onclick = async () => {
      await api(`/api/tasks/${task.id}/done`, { method: 'PATCH' });
      load();
    };
    actions.appendChild(doneBtn);

    const editBtn = document.createElement('button');
    editBtn.textContent = 'Edit';
    editBtn.onclick = () => startEdit(task);
    actions.appendChild(editBtn);

    const snoozeSelect = document.createElement('select');
    snoozeSelect.className = 'snooze-select';
    snoozeSelect.innerHTML = `
      <option value="">Snooze…</option>
      <option value="10">10m</option>
      <option value="30">30m</option>
      <option value="60">60m</option>
    `;
    snoozeSelect.onchange = async () => {
      const minutes = Number(snoozeSelect.value);
      if (minutes) {
        await api(`/api/tasks/${task.id}/snooze`, {
          method: 'PATCH',
          body: JSON.stringify({ minutes }),
        });
        load();
      }
    };
    actions.appendChild(snoozeSelect);
  }

  const delBtn = document.createElement('button');
  delBtn.textContent = 'Delete';
  delBtn.onclick = async () => {
    if (editingTaskId === task.id) cancelEdit();
    await api(`/api/tasks/${task.id}`, { method: 'DELETE' });
    load();
  };
  actions.appendChild(delBtn);

  li.appendChild(actions);
  return li;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function load() {
  const tasks = await api('/api/tasks');
  if (!tasks) return;
  todayList.innerHTML = '';
  tomorrowList.innerHTML = '';
  laterList.innerHTML = '';
  doneList.innerHTML = '';

  const today = startOfDay(new Date());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dayAfter = new Date(tomorrow);
  dayAfter.setDate(dayAfter.getDate() + 1);

  let activeCount = 0;
  for (const task of tasks) {
    if (task.done) {
      doneList.appendChild(renderTask(task));
      continue;
    }
    activeCount += 1;
    const dueDate = new Date(task.due_at);
    const target = dueDate < tomorrow ? todayList : dueDate < dayAfter ? tomorrowList : laterList;
    target.appendChild(renderTask(task));
  }

  if (activeCount === 0) {
    todayList.innerHTML = '<li class="muted">Nothing active. Nice.</li>';
  }
}

recurringSelect.addEventListener('change', () => {
  everyNLabel.hidden = recurringSelect.value !== 'every';
});

addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = titleInput.value;
  const notes = notesInput.value;
  const dueAtLocal = dueAtInput.value;
  const recurring =
    recurringSelect.value === 'every' ? `every:${Number(everyNDaysInput.value) || 2}` : recurringSelect.value;
  const nagMinutes = Number(nagMinutesInput.value) || 15;

  const body = JSON.stringify({
    title,
    notes,
    dueAt: new Date(dueAtLocal).toISOString(),
    recurring,
    nagMinutes,
  });

  if (editingTaskId) {
    await api(`/api/tasks/${editingTaskId}`, { method: 'PATCH', body });
  } else {
    await api('/api/tasks', { method: 'POST', body });
  }

  cancelEdit();
  load();
});

cancelEditBtn.addEventListener('click', cancelEdit);

logoutBtn.addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64Safe);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// Native Web Push (iOS 16.4+ / installed PWAs support this) alongside ntfy,
// which stays as the fallback since it needs no browser permission dance.
async function subscribeToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const keyRes = await fetch('/api/push/vapid-public-key');
    if (!keyRes.ok) return; // not configured server-side, skip silently
    const { publicKey } = await keyRes.json();

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }
    await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify(sub) });
  } catch (err) {
    console.error('push subscription failed:', err);
  }
}

// Browser notifications, synced to the same nag schedule as ntfy
function setupNotifications() {
  if (!('Notification' in window)) return;

  if (Notification.permission === 'default') {
    notifBanner.hidden = false;
  } else if (Notification.permission === 'granted') {
    subscribeToPush();
  }

  enableNotifBtn.addEventListener('click', async () => {
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      notifBanner.hidden = true;
      subscribeToPush();
    }
  });
}

async function checkDue() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const due = await api('/api/tasks/due');
  if (!due) return;
  for (const task of due) {
    const naggedAt = task.last_nagged_at ? new Date(task.last_nagged_at).getTime() : 0;
    if (naggedAt > (lastSeenNag[task.id] || 0)) {
      new Notification(`Reminder: ${task.title}`, {
        body: task.notes || 'Tap to mark it done.',
        tag: `task-${task.id}`,
      });
      lastSeenNag[task.id] = naggedAt;
      saveLastSeenNag();
    }
  }
}

// Polling pauses while the tab is hidden and resumes (with an immediate
// refresh) when it becomes visible again, instead of burning serverless
// invocations on a background tab nobody is looking at.
let pollTimers = null;

function startPolling() {
  if (pollTimers) return;
  pollTimers = [setInterval(checkDue, 60 * 1000), setInterval(load, 60 * 1000)];
}

function stopPolling() {
  if (!pollTimers) return;
  pollTimers.forEach(clearInterval);
  pollTimers = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopPolling();
  } else {
    load();
    checkDue();
    startPolling();
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch((err) => {
    console.error('service worker registration failed:', err);
  });
}

load();
setupNotifications();
startPolling();
