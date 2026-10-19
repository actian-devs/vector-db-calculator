/** Formatting helpers. Pure, so they are unit tested alongside the model. */

/** 1_500_000 becomes "1.5M". Used wherever space is tight. */
export function compactItems(n: number): string {
  const v = Math.round(n);
  if (v >= 1e9) return trim(v / 1e9, v / 1e9 < 10) + 'B';
  if (v >= 1e6) return trim(v / 1e6, v / 1e6 < 10) + 'M';
  if (v >= 1e3) return trim(v / 1e3, v / 1e3 < 10) + 'K';
  return String(v);
}

function trim(v: number, oneDecimal: boolean): string {
  return oneDecimal ? v.toFixed(1).replace(/\.0$/, '') : String(Math.round(v));
}

export function fullItems(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/**
 * Returns the number and its unit separately so the unit can be styled down.
 * Decimal units (1 GB = 10^9 bytes), the same unit the memory price is quoted
 * in, so a GB in the cost table and a GB on the cost card are the same size.
 */
export function bytes(b: number): { value: string; unit: string } {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let v = b;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i += 1;
  }
  return {
    value: v < 10 && i > 0 ? v.toFixed(1) : String(Math.round(v)),
    unit: units[i],
  };
}

export function bytesLabel(b: number): string {
  const { value, unit } = bytes(b);
  return `${value} ${unit}`;
}

/**
 * Both ends of the scan range share a unit so it reads as a range rather than
 * two unrelated numbers.
 */
export function scanRange(lowMs: number, highMs: number): { value: string; unit: string } {
  const unit = highMs >= 1000 ? 's' : 'ms';
  const divisor = highMs >= 1000 ? 1000 : 1;
  const fmt = (x: number) => {
    const v = x / divisor;
    if (v < 1) return v.toFixed(2).replace(/0$/, '');
    if (v < 10) return v.toFixed(1);
    return String(Math.round(v));
  };
  return { value: `${fmt(lowMs)}-${fmt(highMs)}`, unit };
}

export function scanLabel(lowMs: number, highMs: number): string {
  const { value, unit } = scanRange(lowMs, highMs);
  return `${value} ${unit}`;
}

/** Decimal gigabytes, for example "12 GB" or "1,200 GB". */
export function gbLabel(gb: number): string {
  if (gb < 10) return `${gb.toFixed(1).replace(/\.0$/, '')} GB`;
  return `${Math.round(gb).toLocaleString('en-US')} GB`;
}

/** A monthly dollar figure. Cents only below $10, thousands separators above. */
export function usd(n: number): string {
  if (n < 10) return `$${n.toFixed(2)}`;
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/** Compact dollars for tight axes, for example "$1.2K" or "$45K". */
export function usdCompact(n: number): string {
  if (n < 1) return `$${n.toFixed(2)}`;
  if (n < 1e3) return `$${Math.round(n)}`;
  if (n < 1e6) return `$${trim(n / 1e3, n / 1e3 < 10)}K`;
  return `$${trim(n / 1e6, n / 1e6 < 10)}M`;
}
