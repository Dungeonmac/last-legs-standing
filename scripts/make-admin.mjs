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
// The SQL goes in a file: passing it on the command line breaks on Windows, where the shell splits it apart.
const dir = mkdtempSync(join(tmpdir(), 'lls-'));
const file = join(dir, 'make-admin.sql');
writeFileSync(file, `UPDATE users SET role = 'admin' WHERE email = '${email}';\nSELECT email, role FROM users WHERE email = '${email}';\n`);
try {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'lls-db', where, '--json', '--file', `"${file}"`], { encoding: 'utf8', shell: true });
  const rows = JSON.parse(out.slice(out.indexOf('['))).at(-1).results;
  console.log(rows.length ? `${rows[0].email} is now an admin (${where.slice(2)}).` : `No account with ${email} yet. Create the account first, then run this again.`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
