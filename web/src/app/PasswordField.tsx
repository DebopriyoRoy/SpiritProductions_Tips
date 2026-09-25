'use client';

import { useId, useState } from 'react';

/**
 * A password box with a show/hide eye. Typing a long passphrase blind is how
 * people end up locked out, and this account locks after repeated failures.
 *
 * The toggle is a button, not a checkbox, so it never submits the form, and it
 * carries aria-pressed so a screen reader announces the current state rather
 * than just "button".
 */
export function PasswordField({
  name, label, autoComplete = 'current-password', autoFocus = false, hint,
}: {
  name: string;
  label: string;
  autoComplete?: string;
  autoFocus?: boolean;
  hint?: string;
}) {
  const [shown, setShown] = useState(false);
  const id = useId();

  return (
    <>
      <label className="f" htmlFor={id}>{label}</label>
      <div className="pwwrap">
        <input
          id={id}
          name={name}
          type={shown ? 'text' : 'password'}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          required
        />
        <button
          type="button"
          className="pweye"
          onClick={() => setShown((s) => !s)}
          aria-pressed={shown}
          aria-label={shown ? 'Hide password' : 'Show password'}
          title={shown ? 'Hide password' : 'Show password'}
        >
          {shown ? <EyeOff /> : <Eye />}
        </button>
      </div>
      {hint ? <p className="sub pwhint">{hint}</p> : null}
    </>
  );
}

const Eye = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"
       stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"
       strokeLinejoin="round">
    <path d="M1.5 12S5 5.5 12 5.5 22.5 12 22.5 12 19 18.5 12 18.5 1.5 12 1.5 12Z" />
    <circle cx="12" cy="12" r="3.2" />
  </svg>
);

const EyeOff = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"
       stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"
       strokeLinejoin="round">
    <path d="M9.9 5.8A9.8 9.8 0 0 1 12 5.5c7 0 10.5 6.5 10.5 6.5a17 17 0 0 1-3.4 4.1" />
    <path d="M6.4 6.5A17 17 0 0 0 1.5 12S5 18.5 12 18.5a9.9 9.9 0 0 0 4.2-.9" />
    <path d="M9.8 9.9a3.2 3.2 0 0 0 4.4 4.4" />
    <path d="m3 3 18 18" />
  </svg>
);
