'use client';

import { useId } from 'react';

export interface Option<T extends string | number | boolean> {
  value: T;
  label: string;
}

interface Props<T extends string | number | boolean> {
  name: string;
  legend: string;
  hint?: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  full?: boolean;
}

/**
 * A radio group styled as a segmented switch. Stays a real radio group so
 * arrow keys, labels and screen readers behave normally.
 */
export function Segmented<T extends string | number | boolean>({
  name,
  legend,
  hint,
  value,
  options,
  onChange,
  full,
}: Props<T>) {
  const id = useId();
  return (
    <div className={full ? 'f full' : 'f'}>
      <span className="lab" id={`${id}-lab`}>
        {legend}
      </span>
      {hint ? <span className="hint">{hint}</span> : null}
      <div className="seg" role="radiogroup" aria-labelledby={`${id}-lab`}>
        {options.map((o) => {
          const optionId = `${id}-${String(o.value)}`;
          return (
            <span key={String(o.value)} style={{ display: 'contents' }}>
              <input
                type="radio"
                id={optionId}
                name={`${name}-${id}`}
                data-field={name}
                value={String(o.value)}
                checked={o.value === value}
                onChange={() => onChange(o.value)}
              />
              <label htmlFor={optionId}>{o.label}</label>
            </span>
          );
        })}
      </div>
    </div>
  );
}
