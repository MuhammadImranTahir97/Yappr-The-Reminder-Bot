const form = document.getElementById('login-form');
const errorEl = document.getElementById('error');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.hidden = true;
  const password = document.getElementById('password').value;
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (res.ok) {
    window.location.href = '/';
  } else {
    errorEl.hidden = false;
  }
});
