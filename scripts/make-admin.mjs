// Gives an existing account admin rights on the LIVE site.
// Usage: npm run make-admin -- someone@example.com        (add --local to change the local database instead)
import { execFileSync } from 'node:child_process';

const email = process.argv.slice(2).find((a) => a.includes('@'));
const where = process.argv.includes('--local') ? '--local' : '--remote';
if (!email || !/^[^\s@'"]+@[^\s@'"]+\.[^\s@'"]+$/.test(email)) {
  console.error('Usage: npm run make-admin -- someone@example.com');
  process.exit(1);
}
const sql = `UPDATE users SET role = 'admin' WHERE email = '${email.toLowerCase()}'; SELECT email, role FROM users WHERE email = '${email.toLowerCase()}';`;
const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'lls-db', where, '--json', '--command', sql], { encoding: 'utf8', shell: true });
const rows = JSON.parse(out.slice(out.indexOf('['))).at(-1).results;
console.log(rows.length ? `${rows[0].email} is now an admin (${where.slice(2)}).` : `No account with ${email} yet. Sign up first, then run this again.`);
