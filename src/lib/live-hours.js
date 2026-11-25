// Whether a place is open right now, from its opening hours and any exception for the day.
// Runs in the browser every minute. Times are Canberra time, whatever the visitor's own clock says.
//
// hours: [{ day: 0-6 (Sunday first), opens: 'HH:mm', closes: 'HH:mm' }]
// exceptions: [{ date: 'YYYY-MM-DD', closed, opens, closes }]
// now: { date: 'YYYY-MM-DD', day: 0-6, minutes: minutes since midnight }

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };

// 07:30 → "7:30am", 20:00 → "8pm".
export function clockText(min) {
  const h = Math.floor(min / 60) % 24, m = min % 60;
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`;
}

// A day's sessions as [open, close] minutes. A close at or before the open runs past midnight.
function sessionsOn(date, day, hours, exceptions) {
  const x = exceptions.find((e) => e.date === date);
  if (x) return x.closed || !x.opens || !x.closes ? [] : [[toMin(x.opens), toMin(x.closes)]];
  return hours.filter((h) => h.day === day).map((h) => {
    const o = toMin(h.opens), c = toMin(h.closes);
    return [o, c <= o ? c + 1440 : c];
  }).sort((a, b) => a[0] - b[0]);
}

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Returns null when there are no hours to go on, otherwise { state, text, detail }.
// state: open | closing (under an hour left) | opening (opens within the hour) | closed
export function liveStatus(hours = [], exceptions = [], now) {
  if (!hours.length) return null;
  const t = now.minutes;

  // Still open from a session yesterday that runs past midnight.
  const yesterday = sessionsOn(addDays(now.date, -1), (now.day + 6) % 7, hours, exceptions);
  const today = sessionsOn(now.date, now.day, hours, exceptions);
  const current = [...yesterday.map(([o, c]) => [o - 1440, c - 1440]), ...today].find(([o, c]) => t >= o && t < c);
  if (current) {
    // A session that ends at midnight carries on into the next day's session from midnight (24 hours days).
    let end = current[1];
    for (let n = 1; n <= 7 && end === 1440 * n; n++) {
      const next = sessionsOn(addDays(now.date, n), (now.day + n) % 7, hours, exceptions).find(([o]) => o === 0);
      if (!next) break;
      end = 1440 * n + next[1];
    }
    if (end >= 1440 * 7) return { state: 'open', text: 'Open 24 hours', detail: '' };
    if (end > 1440) {
      const days = Math.floor((end - 1) / 1440);
      const when = days === 1 ? 'tomorrow' : DAY_SHORT[(now.day + days) % 7];
      return { state: 'open', text: 'Open now', detail: end % 1440 === 0 ? `Until midnight ${days === 1 ? 'tonight' : DAY_SHORT[(now.day + days - 1) % 7]}` : `Until ${when} ${clockText(end % 1440)}` };
    }
    const left = current[1] - t;
    if (left <= 60) return { state: 'closing', text: `Closing in ${left} min${left === 1 ? '' : 's'}`, detail: `Closes ${clockText(current[1])}` };
    return { state: 'open', text: 'Open now', detail: `Until ${clockText(current[1])}` };
  }

  // Next opening in the coming week.
  for (let n = 0; n < 8; n++) {
    const sessions = n === 0 ? today : sessionsOn(addDays(now.date, n), (now.day + n) % 7, hours, exceptions);
    const next = sessions.find(([o]) => n > 0 || o > t);
    if (!next) continue;
    if (n === 0 && next[0] - t <= 60) {
      const wait = next[0] - t;
      return { state: 'opening', text: `Opening in ${wait} min${wait === 1 ? '' : 's'}`, detail: `Opens ${clockText(next[0])}` };
    }
    const when = n === 0 ? '' : n === 1 ? ' tomorrow' : ` ${DAY_SHORT[(now.day + n) % 7]}`;
    return { state: 'closed', text: 'Closed', detail: `Opens${when} ${clockText(next[0])}` };
  }
  return { state: 'closed', text: 'Closed', detail: '' };
}

// The current date, weekday and time in Canberra.
export function canberraNow(at = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(at).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    day: DAY_SHORT.indexOf(parts.weekday),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}
