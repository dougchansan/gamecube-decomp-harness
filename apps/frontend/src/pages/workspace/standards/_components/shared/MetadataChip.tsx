export function MetadataChip({ label, value }: { label?: string; value?: string | number | boolean | null }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <span
      className="inline-flex min-h-[22px] max-w-full items-center gap-1.5 border border-line bg-card px-1.5 py-px text-[10px] leading-snug"
      title={String(value)}
    >
      {label ? <span className="uppercase tracking-[0.06em] text-faint">{label}</span> : null}
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-semibold text-soft">{String(value)}</span>
    </span>
  );
}
