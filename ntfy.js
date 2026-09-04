async function sendNtfy(title, message) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return;
  try {
    await fetch(`https://ntfy.sh/${topic}`, {
      method: 'POST',
      headers: {
        Title: title,
        Priority: 'high',
        Tags: 'bell',
      },
      body: message || 'Tap to open your reminders.',
    });
  } catch (err) {
    console.error('ntfy send failed:', err.message);
  }
}

module.exports = { sendNtfy };
