import {
  buildChartYAxis,
  chartSummary,
  chartValues,
  formatChartAxisLabel,
  type PortfolioChartPoint,
} from '../utils/chart';
import { STARTING_CAPITAL_CENTS } from '../utils/finance';

export function PortfolioHistoryChart({ points }: { points: PortfolioChartPoint[] }) {
  const width = 640;
  const height = 200;
  const padRight = 12;
  const padTop = 18;
  const padBottom = 28;
  const values = chartValues(points);
  const { axisMin, axisMax, ticks, tickSpacing } = buildChartYAxis(values);
  const yLabels = ticks.map(tick => ({
    value: tick,
    label: formatChartAxisLabel(tick, tickSpacing),
  }));
  const padLeft = Math.max(54, Math.max(...yLabels.map(label => label.label.length)) * 7 + 12);
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;
  const axisSpan = Math.max(axisMax - axisMin, 1);
  const scaleY = (value: number) => padTop + innerH - ((value - axisMin) / axisSpan) * innerH;
  const scaleX = (index: number) => padLeft + (index / Math.max(points.length - 1, 1)) * innerW;
  const linePoints = points
    .map((point, index) => `${scaleX(index)},${scaleY(Number(point.portfolioValueCents))}`)
    .join(' ');
  const areaPoints = [
    `${scaleX(0)},${padTop + innerH}`,
    ...points.map((point, index) => `${scaleX(index)},${scaleY(Number(point.portfolioValueCents))}`),
    `${scaleX(points.length - 1)},${padTop + innerH}`,
  ].join(' ');
  const first = points[0]?.portfolioValueCents ?? STARTING_CAPITAL_CENTS;
  const last = points[points.length - 1]?.portfolioValueCents ?? STARTING_CAPITAL_CENTS;
  const changePositive = last >= first;
  const xLabelStride = Math.max(1, Math.floor(points.length / 6));

  return (
    <div className="portfolio-chart">
      <div className="portfolio-chart__header">
        <p className="portfolio-chart__title">24-hour portfolio value</p>
        <p className="portfolio-chart__subtitle">{chartSummary(points)}</p>
      </div>
      <svg aria-label="Portfolio value over the last 24 hours" className="portfolio-chart__svg" role="img" viewBox={`0 0 ${width} ${height}`}>
        {yLabels.map(label => (
          <g key={label.value}>
            <line className="portfolio-chart__grid" x1={padLeft} x2={width - padRight} y1={scaleY(label.value)} y2={scaleY(label.value)} />
            <text className="portfolio-chart__ylabel" textAnchor="end" x={padLeft - 6} y={scaleY(label.value) + 4}>
              {label.label}
            </text>
          </g>
        ))}
        <polygon fill={changePositive ? 'rgb(134 239 172 / 18%)' : 'rgb(252 165 165 / 18%)'} points={areaPoints} />
        <polyline fill="none" points={linePoints} stroke={changePositive ? '#86efac' : '#fca5a5'} strokeWidth="2.5" />
        {points.map((point, index) =>
          index % xLabelStride === 0 || index === points.length - 1 ? (
            <text className="portfolio-chart__xlabel" key={point.hourStartMicros.toString()} textAnchor="middle" x={scaleX(index)} y={height - 6}>
              {point.label}
            </text>
          ) : null
        )}
      </svg>
    </div>
  );
}
