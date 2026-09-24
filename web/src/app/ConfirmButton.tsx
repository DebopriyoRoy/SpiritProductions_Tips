'use client';

/**
 * A submit button that asks first. Used for the destructive actions — deleting
 * a show, and clearing a night's selections — both of which throw away work
 * that cannot be recovered from the app.
 */
export function ConfirmButton({
  children, message, className = 'btn ghost small',
}: { children: React.ReactNode; message: string; className?: string }) {
  return (
    <button
      className={className}
      type="submit"
      onClick={(e) => { if (!window.confirm(message)) e.preventDefault(); }}
    >
      {children}
    </button>
  );
}
