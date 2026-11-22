import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveStatus, canberraNow, clockText } from '../src/lib/live-hours.js';

// FoodWorks Holder: Mon–Sat 7:30am–8:30pm, Sun 8am–8pm.
const hours = [0, 1, 2, 3, 4, 5, 6].map((day) => (day === 0 ? { day, opens: '08:00', closes: '20:00' } : { day, opens: '07:30', closes: '20:30' }));
const at = (date, day, hhmm) => ({ date, day, minutes: Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) });

test('open, closing soon, opening soon and closed', () => {
  assert.deepEqual(liveStatus(hours, [], at('2026-11-23', 1, '12:00')), { state: 'open', text: 'Open now', detail: 'Until 8:30pm' });
  assert.equal(liveStatus(hours, [], at('2026-11-23', 1, '20:05')).text, 'Closing in 25 mins');
  assert.equal(liveStatus(hours, [], at('2026-11-23', 1, '20:29')).text, 'Closing in 1 min');
  assert.equal(liveStatus(hours, [], at('2026-11-23', 1, '07:00')).text, 'Opening in 30 mins');
  assert.deepEqual(liveStatus(hours, [], at('2026-11-23', 1, '05:00')), { state: 'closed', text: 'Closed', detail: 'Opens 7:30am' });
  assert.equal(liveStatus(hours, [], at('2026-11-22', 0, '21:00')).detail, 'Opens tomorrow 7:30am');
});

test('no hours shows nothing; a day with no hours points to the next open day', () => {
  assert.equal(liveStatus([], [], at('2026-11-23', 1, '12:00')), null);
  const weekdays = hours.filter((h) => h.day >= 1 && h.day <= 5);
  assert.equal(liveStatus(weekdays, [], at('2026-11-21', 6, '12:00')).detail, 'Opens Mon 7:30am');
});

test('an exception for today wins over the usual hours', () => {
  assert.equal(liveStatus(hours, [{ date: '2026-12-25', closed: true }], at('2026-12-25', 5, '12:00')).text, 'Closed');
  assert.equal(liveStatus(hours, [{ date: '2026-12-24', closed: false, opens: '07:30', closes: '16:00' }], at('2026-12-24', 4, '15:30')).text, 'Closing in 30 mins');
});

test('Canberra time and clock text', () => {
  assert.deepEqual(canberraNow(new Date('2026-11-22T13:15:00Z')), { date: '2026-11-23', day: 1, minutes: 15 });
  assert.equal(clockText(450), '7:30am');
  assert.equal(clockText(1200), '8pm');
  assert.equal(clockText(720), '12pm');
});
