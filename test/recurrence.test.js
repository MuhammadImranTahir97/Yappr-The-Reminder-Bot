const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeRecurring, nextOccurrence } = require('../recurrence');

test('normalizeRecurring accepts known values', () => {
  assert.equal(normalizeRecurring('none'), 'none');
  assert.equal(normalizeRecurring('daily'), 'daily');
  assert.equal(normalizeRecurring('weekly'), 'weekly');
  assert.equal(normalizeRecurring('weekdays'), 'weekdays');
  assert.equal(normalizeRecurring('every:5'), 'every:5');
});

test('normalizeRecurring falls back to none for anything invalid', () => {
  assert.equal(normalizeRecurring('bogus'), 'none');
  assert.equal(normalizeRecurring('every:1'), 'none'); // below the 2-day minimum
  assert.equal(normalizeRecurring('every:400'), 'none'); // above the 365-day maximum
  assert.equal(normalizeRecurring(undefined), 'none');
  assert.equal(normalizeRecurring(null), 'none');
  assert.equal(normalizeRecurring(42), 'none');
});

test('nextOccurrence: daily task completed on time advances by exactly 1 day', () => {
  const due = new Date('2026-09-01T09:00:00Z');
  const now = new Date('2026-09-01T08:00:00Z'); // before due
  assert.equal(nextOccurrence(due, 'daily', now).toISOString(), '2026-09-02T09:00:00.000Z');
});

test('nextOccurrence: daily task missed for 3 days lands in the future, not still overdue', () => {
  const due = new Date('2026-09-01T09:00:00Z');
  const now = new Date('2026-09-04T11:00:00Z'); // 3+ days later
  const next = nextOccurrence(due, 'daily', now);
  assert.ok(next > now, 'next occurrence must be after now');
  assert.equal(next.toISOString(), '2026-09-05T09:00:00.000Z');
});

test('nextOccurrence: weekly steps forward by 7 days', () => {
  const due = new Date('2026-09-01T09:00:00Z');
  const now = new Date('2026-09-01T08:00:00Z');
  assert.equal(nextOccurrence(due, 'weekly', now).toISOString(), '2026-09-08T09:00:00.000Z');
});

test('nextOccurrence: every:N steps by N days and skips past cycles that are still overdue', () => {
  const due = new Date('2026-08-25T09:00:00Z');
  const now = new Date('2026-09-01T09:00:00Z'); // exactly 7 days later
  // steps of 3: 08-28, 08-31, 09-03 - the first one strictly after now
  assert.equal(nextOccurrence(due, 'every:3', now).toISOString(), '2026-09-03T09:00:00.000Z');
});

test('nextOccurrence: weekdays skips Saturday and Sunday', () => {
  const due = new Date('2026-09-04T09:00:00Z'); // Friday
  const now = new Date('2026-09-04T08:00:00Z'); // before due, same Friday
  assert.equal(nextOccurrence(due, 'weekdays', now).toISOString(), '2026-09-07T09:00:00.000Z'); // Monday
});

test('nextOccurrence: weekdays task overdue past the following Monday lands on Tuesday', () => {
  const due = new Date('2026-09-04T09:00:00Z'); // Friday
  const now = new Date('2026-09-07T09:30:00Z'); // Monday, after that day's slot
  assert.equal(nextOccurrence(due, 'weekdays', now).toISOString(), '2026-09-08T09:00:00.000Z'); // Tuesday
});
