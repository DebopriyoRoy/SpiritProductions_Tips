/**
 * Proves the Gmail credentials work, and optionally sends a real message.
 *
 *   npm run mail-test                  # log in to Gmail, send nothing
 *   npm run mail-test you@example.com  # and send a test email there
 *
 * Run this before trusting the reset flow in production: a wrong App Password
 * fails here in one second, rather than silently swallowing someone's code.
 */
import './env';
import { reportAndExit } from './report';
import { verifyMail, sendMail, mailConfigured } from '../src/lib/mailer';

async function main() {
  if (!mailConfigured()) {
    console.error(
      'SMTP_USER and SMTP_PASS are not set in .env.local.\n\n' +
      'On the sending Google account turn on 2-Step Verification, then go to\n' +
      'Google Account -> Security -> App passwords and generate one for Mail.\n' +
      'Paste the 16 characters without spaces.\n');
    process.exitCode = 1;
    return;
  }

  console.log(`Connecting to ${process.env.SMTP_HOST || 'smtp.gmail.com'}:` +
              `${process.env.SMTP_PORT || 587} as ${process.env.SMTP_USER} ...`);
  await verifyMail();
  console.log('Authenticated. The credentials are good.');

  const to = process.argv[2];
  if (!to) {
    console.log('\nPass an address to send a test message:\n' +
                '  npm run mail-test you@example.com');
    return;
  }

  await sendMail({
    to,
    subject: 'Spirit Tips test message',
    text:
      'This is a test from Spirit Tips.\n\n' +
      'If you are reading it, password-reset codes will arrive too.\n',
  });
  console.log(`Sent a test message to ${to}.`);
}

main()
  .catch(reportAndExit)
  .finally(() => process.exit());
