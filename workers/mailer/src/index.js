// lls-mailer: sends help desk messages to the race team's inbox through Cloudflare Email Routing.
// It has no public address (workers_dev = false, no routes); only the website can call it, through
// the MAILER service binding in the main wrangler.toml. Cloudflare only lets it send to the
// verified destination address set in this folder's wrangler.toml.
import { EmailMessage } from 'cloudflare:email';

const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const wrap = (s) => s.replace(/.{1,76}/g, '$&\r\n');
const header = (s) => `=?UTF-8?B?${b64(String(s).replace(/[\r\n]+/g, ' '))}?=`; // safe for any characters
const isEmail = (s) => /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(s || '');

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const { subject, text, replyTo, replyName } = await request.json();
    if (!subject || !text) return new Response('subject and text are required', { status: 400 });

    const raw = [
      `From: ${header('Last Legs Standing Help Desk')} <${env.FROM}>`,
      `To: <${env.TO}>`,
      ...(isEmail(replyTo) ? [`Reply-To: ${replyName ? `${header(replyName)} ` : ''}<${replyTo}>`] : []),
      `Subject: ${header(subject)}`,
      `Message-ID: <${crypto.randomUUID()}@${env.FROM.split('@')[1]}>`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      wrap(b64(text)),
    ].join('\r\n');

    await env.SEND_EMAIL.send(new EmailMessage(env.FROM, env.TO, raw));
    return new Response('sent');
  },
};
