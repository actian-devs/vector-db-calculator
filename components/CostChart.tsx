'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import {
  COST_CHART_MAX_ITEMS,
  COST_CHART_MIN_ITEMS,
  costSeries,
  memoryCost,
  type CostRange,
} from '@/lib/compute';
import { compactItems, fullItems, usd, usdCompact } from '@/lib/format';
import type { Assumptions } from '@/lib/types';
import { usePrefersReducedMotion } from './useAnimatedNumber';

interface Props {
  dims: number;
  assumptions: Assumptions;
  /** The reader's workload, at twelve months, as on the gauge. */
  items12: number;
  flatCeiling: number;
  pgvectorCeiling: number;
}

/** Everything the plot draws, in log10 space so the tween stays smooth. */
interface Frame {
  low: number[];
  mid: number[];
  high: number[];
  yLo: number;
  yHi: number;
}

const TWEEN_MS = 520;
const HEIGHT = 250;
const X_LO = Math.log10(COST_CHART_MIN_ITEMS);
const X_HI = Math.log10(COST_CHART_MAX_ITEMS);
const X_TICKS = [1e3, 1e4, 1e5, 1e6, 1e7, 1e8];

function frameFor(series: CostRange[]): Frame {
  const low = series.map((p) => Math.log10(p.low));
  const mid = series.map((p) => Math.log10(p.mid));
  const high = series.map((p) => Math.log10(p.high));
  return {
    low,
    mid,
    high,
    yLo: Math.floor(Math.min(...low)),
    yHi: Math.ceil(Math.max(...high)),
  };
}

function lerpFrame(a: Frame, b: Frame, t: number): Frame {
  const mix = (x: number, y: number) => x + (y - x) * t;
  return {
    low: b.low.map((v, i) => mix(a.low[i] ?? v, v)),
    mid: b.mid.map((v, i) => mix(a.mid[i] ?? v, v)),
    high: b.high.map((v, i) => mix(a.high[i] ?? v, v)),
    yLo: mix(a.yLo, b.yLo),
    yHi: mix(a.yHi, b.yHi),
  };
}

/** Eases the drawn frame toward the target. Reduced motion jumps straight there. */
function useTweenedFrame(target: Frame): Frame {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(target);
  const current = useRef(target);

  useEffect(() => {
    if (reduced) {
      current.current = target;
      return;
    }
    const from = current.current;
    let start: number | null = null;
    let raf = 0;
    const step = (now: number) => {
      if (start === null) start = now;
      const t = Math.min(1, (now - start) / TWEEN_MS);
      const next = lerpFrame(from, target, 1 - Math.pow(1 - t, 3));
      current.current = next;
      setShown(next);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, reduced]);

  return reduced ? target : shown;
}

/** Tracks the rendered width so text stays at its real size on a phone. */
function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(560);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) =>
      setWidth(Math.round(entry.contentRect.width)),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/**
 * Cost as you scale: monthly memory cost from 1K to 100M items.
 *
 * One series, so no legend box: the band between the low and high list price
 * is labelled directly and the title names what is plotted. Every value the
 * tooltip shows is also in the table beneath it for screen readers.
 */
export function CostChart({
  dims,
  assumptions,
  items12,
  flatCeiling,
  pgvectorCeiling,
}: Props) {
  const series = useMemo(() => costSeries(dims, assumptions), [dims, assumptions]);
  const target = useMemo(() => frameFor(series), [series]);
  const f = useTweenedFrame(target);
  const [wrapRef, width] = useWidth();
  // null: no tooltip. -1: the reader's workload. 0..n: a sampled point.
  const [active, setActive] = useState<number | null>(null);

  const narrow = width < 480;
  const m = { l: narrow ? 46 : 62, r: 14, t: 26, b: 30 };
  const plotW = Math.max(10, width - m.l - m.r);
  const plotH = HEIGHT - m.t - m.b;

  const x = (items: number) => m.l + ((Math.log10(items) - X_LO) / (X_HI - X_LO)) * plotW;
  const yLog = (v: number) => m.t + (1 - (v - f.yLo) / (f.yHi - f.yLo || 1)) * plotH;
  const xs = series.map((p) => x(p.items));

  const line = (vals: number[]) =>
    vals
      .map((v, i) => `${i === 0 ? 'M' : 'L'}${xs[i].toFixed(1)},${yLog(v).toFixed(1)}`)
      .join('');
  const band =
    line(f.low) +
    f.high
      .map((v, i) => i)
      .reverse()
      .map((i) => `L${xs[i].toFixed(1)},${yLog(f.high[i]).toFixed(1)}`)
      .join('') +
    'Z';

  // Decade gridlines on the target domain, thinned so labels never crowd.
  const decades: number[] = [];
  for (let d = Math.round(target.yLo); d <= Math.round(target.yHi); d += 1)
    decades.push(d);
  const stepEvery = decades.length > 6 ? 2 : 1;
  const yTicks = decades.filter((_, i) => i % stepEvery === 0);
  const yLabel = (d: number) => (narrow ? usdCompact(10 ** d) : usd(10 ** d));

  const inRange = (n: number) => n >= COST_CHART_MIN_ITEMS && n <= COST_CHART_MAX_ITEMS;
  const markers = [
    { id: 'flat', label: 'flat scan', items: flatCeiling },
    { id: 'pg', label: 'pgvector', items: pgvectorCeiling },
  ].filter((mk) => inRange(mk.items));
  // Stack the second label down a row if the two markers sit close together.
  const close =
    markers.length === 2 && Math.abs(x(markers[0].items) - x(markers[1].items)) < 78;

  const you = Math.min(COST_CHART_MAX_ITEMS, Math.max(COST_CHART_MIN_ITEMS, items12));
  const youCost = memoryCost(items12, dims, assumptions).monthly;
  const youX = x(you);
  const youY = yLog(Math.log10(memoryCost(you, dims, assumptions).monthly.mid));

  const tip =
    active === null
      ? null
      : active === -1
        ? {
            items: items12,
            cost: youCost,
            px: youX,
            label: 'Your workload, in 12 months',
          }
        : {
            items: series[active].items,
            cost: series[active],
            px: xs[active],
            label: null,
          };

  // With list prices close together the band is thinner than the line, so say
  // how wide it is rather than point at something the reader cannot see.
  const spread =
    (Math.max(assumptions.priceLowPerGbMonth, assumptions.priceHighPerGbMonth) /
      Math.min(assumptions.priceLowPerGbMonth, assumptions.priceHighPerGbMonth) -
      1) *
    100;
  const pct = spread < 1 ? spread.toFixed(1) : String(Math.round(spread));
  const bandNote = spread < 5 ? `, only ${pct}% apart, so it sits under the line` : '';

  // The tooltip sits beside the crosshair, on the side away from the rising line.
  const tipStyle = (px: number) =>
    px > m.l + plotW / 2
      ? { right: width - px + 12, top: m.t + plotH * 0.42 }
      : { left: px + 12, top: m.t + 4 };

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = (e.clientX - rect.left) / rect.width;
    setActive(
      Math.max(0, Math.min(series.length - 1, Math.round(t * (series.length - 1)))),
    );
  };

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const last = series.length - 1;
    const from =
      active === null || active === -1
        ? Math.round(((Math.log10(you) - X_LO) / (X_HI - X_LO)) * last)
        : active;
    const moves: Record<string, number> = {
      ArrowRight: Math.min(last, from + 5),
      ArrowLeft: Math.max(0, from - 5),
      Home: 0,
      End: last,
    };
    if (e.key in moves) {
      e.preventDefault();
      setActive(moves[e.key]);
    } else if (e.key === 'Escape') {
      setActive(null);
    }
  };

  const tableRows = X_TICKS.map((items) => ({
    items,
    cost: memoryCost(items, dims, assumptions).monthly,
  }));

  return (
    <div className="card chcard" data-testid="cost-chart">
      <div className="ch">Cost as you scale</div>
      <div className="cs">memory per month, log scales on both axes</div>
      {/* The band label lives here rather than in the plot: it collided with
          the ceiling labels, and a band under 1% wide has no room of its own. */}
      <p className="ch-key" data-testid="band-label">
        <i aria-hidden="true" />
        Line is the midpoint. Band is the low to high list price{bandNote}.
      </p>

      <div className="chart-wrap" ref={wrapRef}>
        {/* 100% wide so the pre-measure default can never overflow a phone;
            the viewBox matches the measured width once it is known. */}
        <svg
          width="100%"
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          preserveAspectRatio="xMinYMin meet"
          tabIndex={0}
          aria-label="Monthly memory cost against item count. Arrow keys move through the curve; the table below has the same figures."
          aria-describedby="cost-chart-table"
          onFocus={() => setActive((a) => (a === null ? -1 : a))}
          onBlur={() => setActive(null)}
          onKeyDown={onKey}
        >
          {yTicks.map((d) => (
            <g key={`y${d}`}>
              <line
                className="ch-grid"
                x1={m.l}
                x2={m.l + plotW}
                y1={yLog(d)}
                y2={yLog(d)}
              />
              <text
                className="ch-tick"
                x={m.l - 8}
                y={yLog(d)}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {yLabel(d)}
              </text>
            </g>
          ))}
          {X_TICKS.map((n) => (
            <text
              key={`x${n}`}
              className="ch-tick"
              x={x(n)}
              y={HEIGHT - 10}
              textAnchor={
                n === X_TICKS[0]
                  ? 'start'
                  : n === X_TICKS[X_TICKS.length - 1]
                    ? 'end'
                    : 'middle'
              }
            >
              {compactItems(n)}
            </text>
          ))}

          {markers.map((mk, i) => (
            <g key={mk.id} data-testid={`marker-${mk.id}`}>
              <line
                className="ch-marker"
                x1={x(mk.items)}
                x2={x(mk.items)}
                y1={m.t}
                y2={m.t + plotH}
              />
              <text
                className="ch-mlabel"
                x={x(mk.items)}
                y={close && i === 1 ? m.t - 2 + 13 : m.t - 8}
                textAnchor={x(mk.items) > m.l + plotW - 60 ? 'end' : 'middle'}
              >
                {mk.label}
              </text>
            </g>
          ))}

          <path className="ch-band" d={band} />
          <path className="ch-mid" d={line(f.mid)} />

          {tip ? (
            <line
              className="ch-cross"
              x1={tip.px}
              x2={tip.px}
              y1={m.t}
              y2={m.t + plotH}
            />
          ) : null}

          <circle className="ch-you" cx={youX} cy={youY} r={5} data-testid="chart-you" />
          <text
            className="ch-ylabel"
            x={youX + (youX > m.l + plotW - 90 ? -10 : 10)}
            y={youY - 10}
            textAnchor={youX > m.l + plotW - 90 ? 'end' : 'start'}
          >
            you
          </text>

          <rect
            className="ch-hit"
            x={m.l}
            y={m.t}
            width={plotW}
            height={plotH}
            onPointerMove={onMove}
            onPointerLeave={() => setActive(null)}
          />
        </svg>

        {tip ? (
          <div
            className="ch-tip"
            role="status"
            data-testid="chart-tip"
            style={tipStyle(tip.px)}
          >
            {tip.label ? <span className="ch-tip-h">{tip.label}</span> : null}
            <span className="ch-tip-h">{fullItems(tip.items)} items</span>
            <span>
              <b data-testid="tip-low">{usd(tip.cost.low)}</b> low
            </span>
            <span>
              <b data-testid="tip-mid">{usd(tip.cost.mid)}</b> mid
            </span>
            <span>
              <b data-testid="tip-high">{usd(tip.cost.high)}</b> high
            </span>
          </div>
        ) : null}
      </div>

      {/* The class goes on a wrapper: a table ignores the 1px box and still widens the page. */}
      <div className="visually-hidden">
        <table id="cost-chart-table" data-testid="cost-chart-table">
          <caption>Monthly memory cost by item count at {dims} dimensions</caption>
          <thead>
            <tr>
              <th scope="col">Items</th>
              <th scope="col">Low</th>
              <th scope="col">Mid</th>
              <th scope="col">High</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((r) => (
              <tr key={r.items}>
                <th scope="row">{fullItems(r.items)}</th>
                <td>{usd(r.cost.low)}</td>
                <td>{usd(r.cost.mid)}</td>
                <td>{usd(r.cost.high)}</td>
              </tr>
            ))}
            <tr>
              <th scope="row">Your workload, {fullItems(items12)} items in 12 months</th>
              <td>{usd(youCost.low)}</td>
              <td>{usd(youCost.mid)}</td>
              <td>{usd(youCost.high)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
