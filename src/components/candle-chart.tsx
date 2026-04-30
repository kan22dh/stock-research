"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type CandlestickData,
  type HistogramData,
  type LineData,
  type Time,
  CrosshairMode,
} from "lightweight-charts";

export type CandlePoint = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

const TIMEFRAMES = [
  { id: "3M", label: "3ヶ月", days: 90 },
  { id: "6M", label: "6ヶ月", days: 180 },
  { id: "1Y", label: "1年", days: 365 },
  { id: "ALL", label: "全期間", days: 9999 },
] as const;

type TimeframeId = (typeof TIMEFRAMES)[number]["id"];

function sma(values: number[], window: number): Array<number | null> {
  const out: Array<number | null> = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    out.push(i >= window - 1 ? sum / window : null);
  }
  return out;
}

export function CandleChart({ data }: { data: CandlePoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [timeframe, setTimeframe] = useState<TimeframeId>("1Y");
  const [showMA20, setShowMA20] = useState(true);
  const [showMA50, setShowMA50] = useState(true);

  const filtered = useMemo(() => {
    const tf = TIMEFRAMES.find((t) => t.id === timeframe);
    if (!tf || tf.days >= 9999) return data;
    return data.slice(Math.max(0, data.length - tf.days));
  }, [data, timeframe]);

  useEffect(() => {
    if (!containerRef.current || filtered.length === 0) return;

    const isDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;

    const chart: IChartApi = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 460,
      layout: {
        background: { color: "transparent" },
        textColor: isDark ? "#d4d4d4" : "#262626",
      },
      grid: {
        vertLines: { color: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)" },
        horzLines: { color: isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.05)" },
      },
      rightPriceScale: {
        borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)",
      },
      timeScale: {
        borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)",
        timeVisible: false,
        secondsVisible: false,
      },
      crosshair: { mode: CrosshairMode.Normal },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#16a34a",
      downColor: "#dc2626",
      borderUpColor: "#16a34a",
      borderDownColor: "#dc2626",
      wickUpColor: "#16a34a",
      wickDownColor: "#dc2626",
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: "#737373",
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.78, bottom: 0 },
    });

    const candleData: CandlestickData[] = filtered.map((d) => ({
      time: d.time as Time,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));
    const volumeData: HistogramData[] = filtered.map((d) => ({
      time: d.time as Time,
      value: d.volume,
      color: d.close >= d.open ? "rgba(22, 163, 74, 0.4)" : "rgba(220, 38, 38, 0.4)",
    }));

    candleSeries.setData(candleData);
    volumeSeries.setData(volumeData);

    if (showMA20 || showMA50) {
      const closes = filtered.map((d) => d.close);
      if (showMA20) {
        const ma = sma(closes, 20);
        const series = chart.addSeries(LineSeries, {
          color: "#3b82f6",
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          title: "MA20",
        });
        const lineData: LineData[] = ma
          .map((v, i) =>
            v != null
              ? { time: filtered[i].time as Time, value: v }
              : null,
          )
          .filter((v): v is LineData => v !== null);
        series.setData(lineData);
      }
      if (showMA50) {
        const ma = sma(closes, 50);
        const series = chart.addSeries(LineSeries, {
          color: "#a855f7",
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          title: "MA50",
        });
        const lineData: LineData[] = ma
          .map((v, i) =>
            v != null
              ? { time: filtered[i].time as Time, value: v }
              : null,
          )
          .filter((v): v is LineData => v !== null);
        series.setData(lineData);
      }
    }

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
  }, [filtered, showMA20, showMA50]);

  if (data.length === 0) {
    return (
      <div className="h-[460px] flex items-center justify-center text-sm text-neutral-500 border border-dashed rounded-xl">
        価格データがありません
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2 px-1">
        <div className="flex items-center gap-1">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.id}
              type="button"
              onClick={() => setTimeframe(tf.id)}
              className={`text-xs px-2.5 py-1 rounded-md transition ${
                timeframe === tf.id
                  ? "bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-medium"
                  : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={showMA20}
              onChange={(e) => setShowMA20(e.target.checked)}
              className="accent-blue-500"
            />
            <span className="text-blue-500 font-medium">MA20</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={showMA50}
              onChange={(e) => setShowMA50(e.target.checked)}
              className="accent-purple-500"
            />
            <span className="text-purple-500 font-medium">MA50</span>
          </label>
        </div>
      </div>
      <div ref={containerRef} className="w-full" />
    </div>
  );
}
