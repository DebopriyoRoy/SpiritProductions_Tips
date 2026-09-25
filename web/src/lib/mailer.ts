import nodemailer, { type Transporter } from 'nodemailer';

/**
 * Outgoing mail, over Gmail's SMTP.
 *
 * Gmail will not accept an account password here: the account needs 2-Step
 * Verification on and a 16-character App Password generated for it, which
 * goes in SMTP_PASS. See .env.example.
 *
 * With nothing configured the message is written to the server log instead of
 * sent, so the reset flow can be exercised locally without credentials. That
 * fallback only ever runs outside production — a misconfigured deployment
 * must fail loudly rather than quietly print reset codes into a log.
 */

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

const conf = () => ({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT || 587),
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
});

export const mailConfigured = () => {
  const c = conf();
  return Boolean(c.user && c.pass);
};

let cached: Transporter | null = null;

function transport(): Transporter {
  if (cached) return cached;
  const c = conf();
  cached = nodemailer.createTransport({
    host: c.host,
    // 587 is STARTTLS, 465 is implicit TLS. Gmail offers both.
    port: c.port,
    secure: c.port === 465,
    auth: { user: c.user, pass: c.pass },
  });
  return cached;
}

export async function sendMail(mail: Mail): Promise<void> {
  const c = conf();

  if (!mailConfigured()) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'Email is not configured. Set SMTP_USER and SMTP_PASS (a Gmail App ' +
        'Password) so the app can send sign-in codes.');
    }
    console.log(
      `\n[mail: not configured, logging instead]\n  to: ${mail.to}\n` +
      `  subject: ${mail.subject}\n  ${mail.text.replace(/\n/g, '\n  ')}\n`);
    return;
  }

  await transport().sendMail({
    from: c.from,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
  });
}

/** Proves the credentials work without sending anything. */
export async function verifyMail(): Promise<void> {
  if (!mailConfigured()) throw new Error('SMTP_USER and SMTP_PASS are not set.');
  await transport().verify();
}
