export function StyleSlider({
  label,
  max,
  min,
  onChange,
  step,
  value,
  valueLabel,
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step: number;
  value: number;
  valueLabel: string;
}) {
  return (
    <label className="block text-[10px] uppercase tracking-[0.08em] text-dim">
      <span className="flex items-center justify-between gap-3">
        <span>{label}</span>
        <span className="text-[11px] normal-case tracking-normal text-soft">{valueLabel}</span>
      </span>
      <input className="style-range mt-2" max={max} min={min} onChange={(event) => onChange(Number(event.currentTarget.value))} step={step} type="range" value={value} />
    </label>
  );
}
