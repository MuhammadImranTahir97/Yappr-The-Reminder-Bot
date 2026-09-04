const activeList = document.getElementById('active-list');
const doneList = document.getElementById('done-list');
const addForm = document.getElementById('add-form');
const notifBanner = document.getElementById('notif-banner');
const enableNotifBtn = document.getElementById('enable-notif');
const logoutBtn = document.getElementById('logout');

const NAG_SEEN_KEY = 'nag-last-seen';
const lastSeenNag = JSON.parse(localStorage.getItem(NAG_SEEN_KEY) || '{}');

function saveLastSeenNag() {
  localStorage.setItem(NAG_SEEN_KEY, JSON.stringify(lastSeenNag));
}

function fmt(dt) {
  return new Date(dt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
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
  if (task.recurring === 'daily') parts.push('repeats daily');
  if (!task.done) parts.push(`nags every ${task.nag_minutes}m`);
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
  }

  const delBtn = document.createElement('button');
  delBtn.textContent = 'Delete';
  delBtn.onclick = async () => {
    await api(`/api/tasks/${task.id}`, { method: 'DELETE' });
    load();
  };
  actions.appendChild(delBtn);

  li.appendChild(actions);
  return li;
}

async function load() {
  const tasks = await api('/api/tasks');
  if (!tasks) return;
  activeList.innerHTML = '';
  doneList.innerHTML = '';
  for (const task of tasks) {
    (task.done ? doneList : activeList).appendChild(renderTask(task));
  }
  if (activeList.children.length === 0) {
    activeList.innerHTML = '<li class="muted">Nothing active. Nice.</li>';
  }
}

addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('title').value;
  const notes = document.getElementById('notes').value;
  const dueAtLocal = document.getElementById('dueAt').value;
  const recurring = document.getElementById('recurring').value;
  const nagMinutes = Number(document.getElementById('nagMinutes').value) || 15;

  await api('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({
      title,
      notes,
      dueAt: new Date(dueAtLocal).toISOString(),
      recurring,
      nagMinutes,
    }),
  });

  addForm.reset();
  document.getElementById('nagMinutes').value = 15;
  load();
});

logoutBtn.addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

// Browser notifications, synced to the same nag schedule as ntfy
function setupNotifications() {
  if (!('Notification' in window)) return;

  if (Notification.permission === 'default') {
    notifBanner.hidden = false;
  }

  enableNotifBtn.addEventListener('click', async () => {
    const perm = await Notification.requestPermission();
    if (perm === 'granted') notifBanner.hidden = true;
  });

  setInterval(async () => {
    if (Notification.permission !== 'granted') return;
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
  }, 20 * 1000);
}

load();
setupNotifications();
setInterval(load, 60 * 1000);
