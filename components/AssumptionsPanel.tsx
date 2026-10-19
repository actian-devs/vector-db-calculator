'use client';

import {
  ASSUMPTION_FIELDS,
  DEFAULT_ASSUMPTIONS,
  clampAssumption,
  isCustomised,
} from '@/lib/assumptions';
import { fullItems } from '@/lib/format';
import type { Assumptions } from '@/lib/types';

interface Props {
  assumptions: Assumptions;
  onChange: (next: Assumptions) => void;
}

/**
 * Every estimate the model rests on, editable.
 *
 * This is what makes the result defensible rather than something to take on
 * trust: an engineer can replace our figures with numbers from their own
 * hardware, and whatever they used travels with the shared link and the
 * exported decision record.
 */
export function AssumptionsPanel({ assumptions, onChange }: Props) {
  const customised = isCustomised(assumptions);

  const update = (key: keyof Assumptions, raw: string) => {
    const parsed = Number(raw.replace(/[, _]/g, ''));
    onChange({
      ...assumptions,
      [key]: clampAssumption(key, parsed, assumptions[key]),
    });
  };

  return (
    <details className="card acard">
      <summary>
        <span className="card-h" style={{ margin: 0 }}>
          ASSUMPTIONS
        </span>
        {customised ? <span className="a-flag">EDITED</span> : null}
        <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M6 15l6-6 6 6" />
        </svg>
      </summary>

      <p className="a-intro">
        These are rule-of-thumb estimates, not benchmark results. Replace them with figures
        from your own hardware and the verdict recalculates. Whatever you set travels with
        the shared link and appears in the exported record.
      </p>

      <div className="a-rows">
        {ASSUMPTION_FIELDS.map((field) => {
          const changed = assumptions[field.key] !== DEFAULT_ASSUMPTIONS[field.key];
          return (
            <div className="a-row" key={field.key}>
              <label htmlFor={`a-${field.key}`}>
                {field.label}
                <span className="ah">{field.help}</span>
              </label>
              <input
                id={`a-${field.key}`}
                data-assumption={field.key}
                data-changed={changed}
                type="number"
                inputMode="decimal"
                min={field.min}
                max={field.max}
                step={field.step}
                value={assumptions[field.key]}
                onChange={(e) => update(field.key, e.target.value)}
                aria-describedby={`a-${field.key}-help`}
              />
              <span id={`a-${field.key}-help`} className="visually-hidden">
                {field.help} Default {field.scale === 'usd' ? `$${DEFAULT_ASSUMPTIONS[field.key].toFixed(2)}` : fullItems(DEFAULT_ASSUMPTIONS[field.key])}.
              </span>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className="a-reset"
        disabled={!customised}
        onClick={() => onChange({ ...DEFAULT_ASSUMPTIONS })}
      >
        reset to defaults
      </button>
    </details>
  );
}
