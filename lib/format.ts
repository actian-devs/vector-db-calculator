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

/** Returns the number and its unit separately so the unit can be styled down. */
export function bytes(b: number): { value: string; unit: string } {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let v = b;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
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
