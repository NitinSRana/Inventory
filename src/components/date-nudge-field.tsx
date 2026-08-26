'use client';

import { useState } from 'react';

import { Input } from '@/components/ui/input';

/**
 * A date input plus ±1 day / +1 week nudges — covers almost every correction
 * to a suggested expiry without opening the OS date picker one-handed.
 */
export function DateNudgeInput({
  id,
  name,
  defaultValue,
  labels,
}: {
  id: string;
  name: string;
  defaultValue?: string;
  labels: { minusDay: string; plusDay: string; plusWeek: string };
}) {
  const [value, setValue] = useState(defaultValue ?? '');

  function nudge(days: number) {
    const base = value ? new Date(`${value}T00:00:00Z`) : new Date();
    base.setUTCDate(base.getUTCDate() + days);
    setValue(base.toISOString().slice(0, 10));
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        id={id}
        name={name}
        type="date"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoFocus
        className="focus-visible:ring-3 h-14 text-lg"
      />
      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => nudge(-1)}
          className="h-11 rounded-lg border text-sm font-medium"
        >
          {labels.minusDay}
        </button>
        <button
          type="button"
          onClick={() => nudge(1)}
          className="h-11 rounded-lg border text-sm font-medium"
        >
          {labels.plusDay}
        </button>
        <button
          type="button"
          onClick={() => nudge(7)}
          className="h-11 rounded-lg border text-sm font-medium"
        >
          {labels.plusWeek}
        </button>
      </div>
    </div>
  );
}
