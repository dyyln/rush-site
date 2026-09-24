export { BarChart } from "./BarChart";
export { TimeSeriesChart, type ChartPoint, type ChartSeries } from "./TimeSeriesChart";
export { compact } from "./scale";

// Fixed chart colour per mode so a mode keeps its colour on every chart
export const MODE_SERIES_COLOR = {
  aim1v1: "var(--series-1)",
  aim2v2: "var(--series-2)",
  rush3v3: "var(--series-3)",
  rush1v1: "var(--series-4)",
  rush2v2: "var(--series-5)",
} as const;
