const RECURRING_PATTERN = /^(none|daily|weekly|weekdays|every:([2-9]|[1-9]\d|[12]\d\d|3[0-5]\d|36[0-5]))$/;

function normalizeRecurring(value) {
  if (typeof value !== 'string' || !RECURRING_PATTERN.test(value)) return 'none';
  return value;
}

function isWeekday(date) {
  const day = date.getUTCDay(); // 0 = Sunday, 6 = Saturday
  return day !== 0 && day !== 6;
}

// Computes the next due_at strictly after `now` for a recurring task,
// stepping forward from the task's current due_at rather than from now,
// so a task missed for several cycles lands on the next real occurrence
// instead of snapping to a fixed offset from whenever it happened to be
// completed.
function nextOccurrence(dueAt, recurring, now) {
  const next = new Date(dueAt.getTime());

  if (recurring === 'weekdays') {
    do {
      next.setUTCDate(next.getUTCDate() + 1);
    } while (next <= now || !isWeekday(next));
    return next;
  }

  let stepDays = 1;
  if (recurring === 'weekly') stepDays = 7;
  else if (recurring.startsWith('every:')) stepDays = Number(recurring.slice(6)) || 1;

  do {
    next.setUTCDate(next.getUTCDate() + stepDays);
  } while (next <= now);
  return next;
}

module.exports = { normalizeRecurring, nextOccurrence, isWeekday, RECURRING_PATTERN };
