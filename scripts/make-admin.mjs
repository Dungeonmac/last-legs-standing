// Gives an existing account admin rights on the LIVE site.
// Usage: npm run make-admin -- someone@example.com        (add --local to change the local database instead)
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const email = process.argv.slice(2).find((a) => a.includes('@'))?.toLowerCase();
const where = process.argv.includes('--local') ? '--local' : '--remote';
if (!email || !/^[^\s@'"]+@[^\s@'"]+\.[^\s@'"]+$/.test(email)) {
  console.error('Usage: npm run make-admin -- someone@example.com');
  process.exit(1);
}
const wrangler = (args) => execFileSync('npx', ['wrangler', 'd1', 'execute', 'lls-db', where, ...args], { encoding: 'utf8', shell: true });

// The UPDATE goes in a file: passing it on the command line breaks on Windows, where the shell splits it apart.
const dir = mkdtempSync(join(tmpdir(), 'lls-'));
const file = join(dir, 'make-admin.sql');
writeFileSync(file, `UPDATE users SET role = 'admin' WHERE email = '${email}';\n`);
try {
  wrangler(['--yes', '--file', `"${file}"`]);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// Read it back to confirm (running a --file doesn't return rows). The email was validated above, so it's safe to inline.
const out = wrangler(['--json', '--command', `"SELECT email, role FROM users WHERE email = '${email}'"`]);
const row = JSON.parse(out.slice(out.indexOf('['))).at(-1).results[0];
console.log(!row ? `No account with ${email} yet. Create the account first, then run this again.`
  : row.role === 'admin' ? `${row.email} is now an admin (${where.slice(2)}).` : `Could not make ${email} an admin.`);
