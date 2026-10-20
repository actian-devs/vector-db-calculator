'use client';

import { useState, type InputHTMLAttributes } from 'react';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number;
  /** Called once per edit, on blur or Enter, with the parsed number. The caller clamps. */
  onCommit: (next: number) => void;
};

/**
 * A number input that lets you finish typing before anything happens.
 *
 * Committing on every keystroke meant each intermediate value was clamped and
 * written back into the box, so typing "64" into a field with a 0.25 minimum
 * produced "0.2564". The draft lives here while the field has focus and is
 * parsed once, on blur or Enter. Escape puts the last committed value back.
 */
export function NumberField({ value, onCommit, onBlur, onKeyDown, onFocus, ...rest }: Props) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const parsed = Number(draft.replace(/[, _]/g, ''));
    setDraft(null);
    if (draft.trim() !== '' && Number.isFinite(parsed) && parsed !== value) onCommit(parsed);
  };

  return (
    <input
      {...rest}
      type="number"
      value={draft ?? String(value)}
      onFocus={(e) => {
        setDraft(String(value));
        onFocus?.(e);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        commit();
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          // Not blurring here: blur would commit the draft this closure still holds.
          setDraft(null);
        }
        onKeyDown?.(e);
      }}
    />
  );
}
