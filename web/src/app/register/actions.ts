'use server';

import {
  beginEmailVerification, confirmEmailVerification,
} from '@/lib/auth';
import { sendMail } from '@/lib/mailer';

/** Emails a sign-up code. Called from the Register form, not a page submit. */
export async function sendSignupOtp(
  email: string,
): Promise<{ ok: boolean; message: string; retryAfter?: number }> {
  const issued = await beginEmailVerification(email);
  if (!issued.ok || !issued.code) {
    return { ok: false, message: issued.message, retryAfter: issued.retryAfter };
  }

  await sendMail({
    to: email.trim().toLowerCase(),
    subject: 'Your Spirit Tips verification code',
    text:
      'Someone entered this address when registering for Spirit Tips.\n\n' +
      'Your verification code is:\n\n' +
      `    ${issued.code}\n\n` +
      'It expires in 15 minutes.\n\n' +
      'If this was not you, ignore this message. No account has been ' +
      'created and nothing will happen.\n',
  });

  return { ok: true, message: issued.message };
}

/** Checks the typed code so the form can confirm before the final submit. */
export async function verifySignupOtp(
  email: string, code: string,
): Promise<{ ok: boolean; message: string }> {
  return confirmEmailVerification(email, code);
}
