// Makes an existing account the site OWNER (on the LIVE site); any previous owner becomes a regular admin.
// The owner can only be removed as an admin with the owner password (OWNER_PASSWORD_HASH).
// Usage: npm run make-owner -- someone@example.com        (add --local for the local database)
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const email = process.argv.slice(2).find((a) => a.includes('@'))?.toLowerCase();
const where = process.argv.includes('--local') ? '--local' : '--remote';
if (!email || !/^[^\s@'"]+@[^\s@'"]+\.[^\s@'"]+$/.test(email)) {
  console.error('Usage: npm run make-owner -- someone@example.com');
  process.exit(1);
}
const wrangler = (args) => execFileSync('npx', ['wrangler', 'd1', 'execute', 'lls-db', where, ...args], { encoding: 'utf8', shell: true });
const rows = (sql) => { const out = wrangler(['--json', '--command', `"${sql}"`]); return JSON.parse(out.slice(out.indexOf('['))).at(-1).results; };

if (!rows(`SELECT id FROM users WHERE email = '${email}'`).length) {
  console.log(`No account with ${email} yet. Create the account first (Log in → Create an account), then run this again.`);
  process.exit(1);
}
const dir = mkdtempSync(join(tmpdir(), 'lls-'));
const file = join(dir, 'make-owner.sql');
// Only demote the old owner if the new one exists (checked above), so the site is never left without an owner.
writeFileSync(file, `UPDATE users SET role = 'admin' WHERE role = 'owner' AND email != '${email}';\nUPDATE users SET role = 'owner' WHERE email = '${email}';\n`);
try { wrangler(['--yes', '--file', `"${file}"`]); } finally { rmSync(dir, { recursive: true, force: true }); }
for (const r of rows(`SELECT email, role FROM users WHERE role IN ('owner', 'admin') ORDER BY role DESC`)) console.log(`${r.role.padEnd(6)} ${r.email}`);
