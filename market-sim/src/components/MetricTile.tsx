export function MetricTile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="metric-tile">
      <span className="muted">{label}</span>
      <strong style={{ color: accent }}>{value}</strong>
    </div>
  );
}
