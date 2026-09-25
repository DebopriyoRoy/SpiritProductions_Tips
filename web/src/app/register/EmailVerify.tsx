'use client';

import { useEffect, useState, useTransition } from 'react';
import { sendSignupOtp, verifySignupOtp } from './actions';

const looksLikeEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

/**
 * Email box that grows a "Send OTP" button and a code box once the address
 * looks complete, and confirms the code before the form may be submitted.
 *
 * The verified address is carried in a hidden field so the server re-checks
 * the same one it issued the code for. Nothing here is trusted: the register
 * action verifies again server-side, because a client can claim anything.
 */
export function EmailVerify() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [verified, setVerified] = useState(false);
  const [note, setNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [pending, start] = useTransition();

  const ready = looksLikeEmail(email);

  // Changing the address invalidates anything already verified.
  useEffect(() => {
    setVerified(false);
    setSent(false);
    setCode('');
    setNote(null);
  }, [email]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const send = () => start(async () => {
    const res = await sendSignupOtp(email);
    setNote({ kind: res.ok ? 'ok' : 'err', text: res.message });
    if (res.ok) { setSent(true); setCooldown(60); }
    else if (res.retryAfter) setCooldown(res.retryAfter);
  });

  const verify = () => start(async () => {
    const res = await verifySignupOtp(email, code);
    setNote({ kind: res.ok ? 'ok' : 'err', text: res.message });
    setVerified(res.ok);
  });

  return (
    <>
      <label className="f" htmlFor="email">Email</label>
      <input
        id="email" name="email" type="email" autoComplete="username" required
        value={email} onChange={(e) => setEmail(e.target.value)}
      />
      {/* What the server re-checks. */}
      <input type="hidden" name="verifiedEmail" value={verified ? email : ''} />

      {ready && !verified ? (
        <div className="otprow">
          <button type="button" className="btn ghost" onClick={send}
                  disabled={pending || cooldown > 0}>
            {cooldown > 0
              ? `Resend in ${cooldown}s`
              : sent ? 'Resend OTP' : 'Send OTP'}
          </button>
          {sent ? (
            <>
              <input
                className="otp otp-inline" name="code" type="text"
                inputMode="numeric" pattern="[0-9]*" maxLength={6}
                placeholder="000000" aria-label="Verification code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
              <button type="button" className="btn ghost" onClick={verify}
                      disabled={pending || code.length !== 6}>
                Verify
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {verified ? (
        <p className="sub verified">✓ {email} verified</p>
      ) : null}

      {note ? (
        <p className={note.kind === 'err' ? 'sub otpnote err' : 'sub otpnote'}
           role="status">
          {note.text}
        </p>
      ) : null}
    </>
  );
}
