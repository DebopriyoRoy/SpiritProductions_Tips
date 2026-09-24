'use client';

import { useEffect } from 'react';

/**
 * Keeps "Total tips" equal to gratuity + cash + Square tips as they are typed.
 *
 * It only writes when one of the three parts is edited, so a show recorded as a
 * lump sum — the parts unknown, the total entered directly — keeps its figure
 * instead of being zeroed on load.
 */
export function TipsTotal({
  partIds, totalId,
}: { partIds: string[]; totalId: string }) {
  useEffect(() => {
    const parts = partIds
      .map((id) => document.getElementById(id) as HTMLInputElement | null)
      .filter(Boolean) as HTMLInputElement[];
    const total = document.getElementById(totalId) as HTMLInputElement | null;
    if (!total || parts.length === 0) return;

    const recalc = () => {
      const sum = parts.reduce((a, el) => a + (Number(el.value) || 0), 0);
      total.value = sum.toFixed(2);
      // let anything else watching the form (the save bar) notice
      total.dispatchEvent(new Event('input', { bubbles: true }));
    };

    parts.forEach((el) => el.addEventListener('input', recalc));
    return () => parts.forEach((el) => el.removeEventListener('input', recalc));
  }, [partIds, totalId]);

  return null;
}
