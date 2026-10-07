import { useId } from "react";
import { cn } from "@/lib/format";

export interface SparklineProps {
  /** Series values, oldest first. */
  values: number[];
  secondary?: number[];
  height?: number;
  stroke?: string;
  secondaryStroke?: string;
  fill?: boolean;
  className?: string;
  /** Value shown as the hover-free "max" gridline label. */
  max?: number;
}

/**
 * Dependency-free SVG chart.
 * Recharts was skipped on purpose: it is ~120 kB gzipped and drags in d3
 * helpers that a Termux install has to build/download for a 90 px tall
 * sparkline. viewBox + preserveAspectRatio="none" keeps it resolution
 * independent, and axis labels live in HTML so they never distort.
 */
export function Sparkline({
  values,
  secondary,
  height = 90,
  stroke = "rgba(129,140,248,1)",
  secondaryStroke = "rgba(16,185,129,0.8)",
  fill = true,
  className,
  max,
}: SparklineProps) {
  const gradientId = useId();
  const width = 300;
  const count = Math.max(values.length, secondary?.length ?? 0);

  if (count === 0) {
    return (
      <div
        className={cn("grid place-items-center text-xs text-[var(--frost-muted)]", className)}
        style={{ height }}
      >
        no data yet
      </div>
    );
  }

  const peak = Math.max(1, max ?? Math.max(...values, ...(secondary ?? [0])));
  const x = (index: number) => (count === 1 ? 0 : (index / (count - 1)) * width);
  const y = (value: number) => height - (Math.max(0, value) / peak) * (height - 4) - 2;

  const line = (series: number[]) =>
    series.map((value, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(2)},${y(value).toFixed(2)}`).join(" ");

  const area = `${line(values)} L${width},${height} L0,${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn("w-full", className)}
      style={{ height }}
      role="img"
      aria-label={`Chart with ${count} points, peak ${Math.round(peak)}`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.45" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((ratio) => (
        <line
          key={ratio}
          x1="0"
          x2={width}
          y1={height * ratio}
          y2={height * ratio}
          stroke="currentColor"
          strokeOpacity="0.08"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {fill ? <path d={area} fill={`url(#${gradientId})`} /> : null}
      {secondary && secondary.length > 1 ? (
        <path
          d={line(secondary)}
          fill="none"
          stroke={secondaryStroke}
          strokeWidth="1.5"
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      <path
        d={line(values)}
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
