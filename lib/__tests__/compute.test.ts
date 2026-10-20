import { describe, expect, it } from 'vitest';
import { DEFAULT_ASSUMPTIONS } from '../assumptions';
import { footprint, logPosition } from '../compute';
import { bytes, compactItems, scanRange } from '../format';

describe('footprint arithmetic is exact', () => {
  it('computes float32 memory as items x dims x 4', () => {
    const f = footprint(1_000_000, 1536, DEFAULT_ASSUMPTIONS);
    expect(f.float32Bytes).toBe(1_000_000 * 1536 * 4);
    expect(f.int8Bytes).toBe(1_000_000 * 1536);
    expect(f.float32Bytes / f.int8Bytes).toBe(4);
  });

  it('counts one comparison per component per item', () => {
    expect(footprint(10, 384, DEFAULT_ASSUMPTIONS).comparisons).toBe(3_840);
  });

  it('scales the scan range with the throughput assumption', () => {
    const base = footprint(1_000_000, 1536, DEFAULT_ASSUMPTIONS);
    const faster = footprint(1_000_000, 1536, {
      ...DEFAULT_ASSUMPTIONS,
      gflopsLow: 10,
      gflopsHigh: 100,
    });
    expect(faster.scanMsHigh).toBeCloseTo(base.scanMsHigh / 10, 6);
    expect(base.scanMsLow).toBeLessThan(base.scanMsHigh);
  });

  it('handles an empty set without dividing by zero', () => {
    const f = footprint(0, 1536, DEFAULT_ASSUMPTIONS);
    expect(f.float32Bytes).toBe(0);
    expect(f.scanMsHigh).toBe(0);
  });
});

describe('log position', () => {
  it('maps the scale ends to 0 and 1', () => {
    expect(logPosition(1_000)).toBeCloseTo(0, 6);
    expect(logPosition(100_000_000)).toBeCloseTo(1, 6);
  });

  it('places 1M in the middle', () => {
    expect(logPosition(1_000_000)).toBeCloseTo(0.6, 6);
  });

  it('clamps rather than overflowing', () => {
    expect(logPosition(1)).toBe(0);
    expect(logPosition(1e12)).toBe(1);
    expect(logPosition(0)).toBe(0);
  });
});

describe('formatting', () => {
  it('compacts large counts', () => {
    expect(compactItems(999)).toBe('999');
    expect(compactItems(1_500)).toBe('1.5K');
    expect(compactItems(10_000)).toBe('10K');
    expect(compactItems(2_000_000)).toBe('2M');
    expect(compactItems(15_000_000_000)).toBe('15B');
  });

  it('splits bytes from their unit', () => {
    expect(bytes(1000)).toEqual({ value: '1.0', unit: 'KB' });
    expect(bytes(6_144_000_000).unit).toBe('GB');
  });

  it('keeps both ends of a scan range in one unit', () => {
    // A range spanning the second boundary must not read as "614-6.1K ms".
    const r = scanRange(614, 6_144);
    expect(r.unit).toBe('s');
    expect(r.value).toBe('0.61-6.1');
  });

  it('stays in milliseconds below a second', () => {
    expect(scanRange(31, 307).unit).toBe('ms');
  });

  it('moves to minutes and hours instead of printing huge second counts', () => {
    expect(scanRange(30_000, 300_000)).toEqual({ value: '0.5-5.0', unit: 'min' });
    expect(scanRange(3_600_000, 36_000_000)).toEqual({ value: '1.0-10', unit: 'h' });
  });

  it('counts past a billion in trillions', () => {
    expect(compactItems(1.6e13)).toBe('16T');
  });

  it('orders the scan range when the throughput inputs are swapped', () => {
    const swapped = { ...DEFAULT_ASSUMPTIONS, gflopsLow: 100, gflopsHigh: 1 };
    const f = footprint(1e6, 1536, swapped);
    expect(f.scanMsLow).toBeLessThan(f.scanMsHigh);
  });
});
