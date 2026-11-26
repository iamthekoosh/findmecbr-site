// Which code built these pages, and when, for the test banner: "Build 3f4a828 · 26 Nov 2026, 10:19 pm".
// On the server, Coolify gives the container the commit as SOURCE_COMMIT. Locally it comes from git.
// The time is when the pages were built (each rebuild from Strapi), in Canberra time.
import { execSync } from 'node:child_process';

function commit() {
  if (process.env.SOURCE_COMMIT && process.env.SOURCE_COMMIT !== 'unknown') return process.env.SOURCE_COMMIT;
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function buildLabel(ref, when) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-AU', {
      timeZone: 'Australia/Sydney', day: 'numeric', month: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
    }).formatToParts(when).map((p) => [p.type, p.value]),
  );
  const date = `${Number(parts.day)} ${MONTHS[parts.month - 1]} ${parts.year}, ${parts.hour}:${parts.minute} ${parts.dayPeriod.toLowerCase()}`;
  return [ref ? `Build ${ref.slice(0, 7)}` : 'Build', date].join(' · ');
}

export const BUILD_LABEL = buildLabel(commit(), new Date());
