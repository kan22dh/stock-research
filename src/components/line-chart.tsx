"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  AreaSeries,
  type IChartApi,
  type AreaData,
  type Time,
} from "lightweight-charts";

export type LinePoint = {
  time: string;
  value: number;
};

export function LineChart({
  data,
  color = "#3b82f6",
  height = 200,
}: {
  data: LinePoint[];
  color?: string;
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;

    const isDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;

    const chart: IChartApi = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { color: "transparent" },
        textColor: isDark ? "#a3a3a3" : "#525252",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)" },
        horzLines: { color: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)" },
      },
      rightPriceScale: {
        borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
      },
      timeScale: {
        borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
        timeVisible: false,
      },
      handleScroll: false,
      handleScale: false,
    });

    const area = chart.addSeries(AreaSeries, {
      lineColor: color,
      topColor: `${color}55`,
      bottomColor: `${color}10`,
      lineWidth: 2,
      priceLineVisible: false,
    });

    const sorted = [...data].sort((a, b) => a.time.localeCompare(b.time));
    const series: AreaData[] = sorted.map((p) => ({
      time: p.time as Time,
      value: p.value,
    }));
    area.setData(series);
    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [data, color, height]);

  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-xs text-neutral-500 border border-dashed rounded-lg"
        style={{ height }}
      >
        データなし
      </div>
    );
  }

  return <div ref={containerRef} className="w-full" />;
}
