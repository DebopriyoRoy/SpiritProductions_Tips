'use client';

import { useState } from 'react';
import { CAST_SECTION } from '@/lib/tips';

/**
 * Adds somebody the roster does not list.
 *
 * Cast and staff are paid on different bases — a cast member takes a share of
 * the cast pool per head, a staff member is paid for hours — so the third
 * field has to change with the choice. Leaving it as "Hours" and quietly
 * ignoring the number for cast would look like it had been recorded.
 */
export function AddPerson({
  sections, hasCast, formId,
}: {
  sections: { value: string; label: string }[];
  hasCast: boolean;
  formId: string;
}) {
  const [section, setSection] = useState(sections[0]?.value ?? '');
  const isCast = section === CAST_SECTION;

  return (
    <div className="grid g4">
      <div>
        <label className="f" htmlFor="newName">Name</label>
        <input id="newName" name="name" type="text" form={formId} required />
      </div>
      <div>
        <label className="f" htmlFor="newSection">Section</label>
        <select
          id="newSection" name="section" form={formId}
          value={section} onChange={(e) => setSection(e.target.value)}
        >
          {sections.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
          {hasCast && (
            <option value={CAST_SECTION}>Cast &amp; Musicians</option>
          )}
        </select>
      </div>
      <div>
        <label className="f" htmlFor="newAmount">
          {isCast ? 'Share' : 'Hours'}
        </label>
        <input
          id="newAmount" className="num"
          // Two names, so the server never has to guess which one it was
          // handed, and an hours figure can never be read as a share.
          name={isCast ? 'ratio' : 'hours'}
          type="number"
          step={isCast ? '0.1' : '0.01'}
          min="0"
          // A cast member is added because they were there, so a full share
          // is the sensible start; hours must be typed in either way.
          defaultValue={isCast ? '1' : '0'}
          key={isCast ? 'ratio' : 'hours'}
          form={formId}
        />
        <p className="sub addhint">
          {isCast
            ? 'A share of 1 is a full cut. They are ticked as having worked.'
            : 'Hours worked on the night.'}
        </p>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        <button className="btn ghost" type="submit" form={formId}>Add</button>
      </div>
    </div>
  );
}
