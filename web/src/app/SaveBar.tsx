'use client';

import { useEffect, useState } from 'react';

/**
 * The sheet runs to several screens, so the Save button in the staff panel is
 * far from most of the fields. This watches the form for edits and, once there
 * are any, pins a save control to the bottom of the window — and warns before
 * the page is abandoned with changes still unsaved.
 *
 * It deliberately keeps no "saving" state: a server action re-renders the page
 * around this component, so any pending flag set here would have nothing to
 * clear it and would strand the button disabled.
 */
export function SaveBar({ formId }: { formId: string }) {
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    // Listen on the document rather than the form node: the form is rendered
    // by a server component and replaced on every revalidation, so a reference
    // captured at mount goes stale and stops reporting edits.
    const inForm = (e: Event) =>
      (e.target as HTMLElement | null)?.closest?.(`#${formId}`) != null;

    const touch = (e: Event) => { if (inForm(e)) setDirty(true); };
    const clear = (e: Event) => { if (inForm(e)) setDirty(false); };

    document.addEventListener('input', touch, true);
    document.addEventListener('change', touch, true);
    document.addEventListener('submit', clear, true);
    return () => {
      document.removeEventListener('input', touch, true);
      document.removeEventListener('change', touch, true);
      document.removeEventListener('submit', clear, true);
    };
  }, [formId]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (!dirty) return null;

  return (
    <div className="savebar" role="status">
      <div className="savebar-inner">
        <span>Unsaved changes</span>
        <button
          className="btn"
          type="button"
          onClick={() => {
            // requestSubmit() with no submitter: a <button form="..."> living
            // outside the form makes React build FormData with a submitter the
            // form does not own, which throws.
            (document.getElementById(formId) as HTMLFormElement | null)
              ?.requestSubmit();
          }}
        >
          Save changes
        </button>
      </div>
    </div>
  );
}
