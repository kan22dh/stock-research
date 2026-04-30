"use client";

import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  type IChartApi,
  type CandlestickData,
  type HistogramData,
  type Time,
  CrosshairMode,
} from "lightweight-charts";

export type CandlePoint = {
  time: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export function CandleChart({ data }: { data: CandlePoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const isDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;

    const chart = createChart(containerRef.current, {
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
      autoSize: false,
    });
    chartRef.current = chart;

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

    const candleData: CandlestickData[] = data.map((d) => ({
      time: d.time as Time,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));
    const volumeData: HistogramData[] = data.map((d) => ({
      time: d.time as Time,
      value: d.volume,
      color: d.close >= d.open ? "rgba(22, 163, 74, 0.4)" : "rgba(220, 38, 38, 0.4)",
    }));

    candleSeries.setData(candleData);
    volumeSeries.setData(volumeData);
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
      chartRef.current = null;
    };
  }, [data]);

  if (data.length === 0) {
    return (
      <div className="h-[460px] flex items-center justify-center text-sm text-neutral-500 border border-dashed rounded-xl">
        価格データがありません
      </div>
    );
  }

  return <div ref={containerRef} className="w-full" />;
}
