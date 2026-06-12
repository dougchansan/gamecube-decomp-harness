import type { ComponentProps, ReactNode } from "react";

type ButtonTone = "default" | "primary" | "warning" | "danger";

const buttonTone: Record<ButtonTone, string> = {
  default: "border-line2 bg-raised text-soft hover:border-faint hover:text-fg",
  primary: "border-up/50 bg-up/10 text-up hover:bg-up/20",
  warning: "border-warn/50 bg-warn/10 text-warn hover:bg-warn/20",
  danger: "border-down/50 bg-down/10 text-down hover:bg-down/20",
};

export function Button({
  children,
  className = "",
  icon,
  tone = "default",
  ...props
}: ComponentProps<"button"> & { icon?: ReactNode; tone?: ButtonTone }) {
  return (
    <button
      className={`inline-flex min-h-7 items-center justify-center gap-1.5 border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] disabled:cursor-not-allowed disabled:opacity-45 ${buttonTone[tone]} ${className}`}
      {...props}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

export function PanelSection({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`border border-line bg-panel p-4 ${className}`}>{children}</section>;
}

export function PanelTitle({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`panel-heading ${className}`}>{children}</div>;
}

/**
 * Shared header zone for the top-bar sections: a fixed 28px title row, so
 * every section's first card starts at the same y.
 */
export function PanelHeader({ right, title }: { right?: ReactNode; title: ReactNode }) {
  return (
    <div className="flex h-7 items-center justify-between gap-2">
      <PanelTitle className="mb-0 min-w-0 flex-1">{title}</PanelTitle>
      {right}
    </div>
  );
}

export function Field({
  label,
  className = "",
  ...props
}: ComponentProps<"input"> & { label: string }) {
  return (
    <label className={`mb-3 block text-[10px] uppercase tracking-[0.08em] text-dim ${className}`} title={props.title}>
      <span>{label}</span>
      <input className="mt-1.5 text-[13px] normal-case tracking-normal" {...props} />
    </label>
  );
}

export function SelectField({
  label,
  options,
  className = "",
  ...props
}: ComponentProps<"select"> & { label: string; options: Array<string | number> }) {
  return (
    <label className={`mb-3 block text-[10px] uppercase tracking-[0.08em] text-dim ${className}`} title={props.title}>
      <span>{label}</span>
      <select className="mt-1.5 text-[13px] normal-case tracking-normal" {...props}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

export function CheckboxField({
  label,
  ...props
}: Omit<ComponentProps<"input">, "type"> & { label: string }) {
  return (
    <label className="mt-2 flex items-center gap-2.5 text-xs text-dim" title={props.title}>
      <input className="min-h-4 w-4" type="checkbox" {...props} />
      <span>{label}</span>
    </label>
  );
}

export function EmptyState({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`border border-dashed border-line2 bg-card p-4 text-center text-dim ${className}`}>{children}</div>;
}

export function Pill({ state }: { state: string }) {
  const tone =
    state === "running" || state === "detached"
      ? "status-tag-live"
      : state === "stopping" || state === "draining"
        ? "status-tag-warn"
        : "";
  return (
    <span className={`status-tag ${tone}`}>
      <span className="lamp" />
      {state}
    </span>
  );
}

export function StackCell({ primary, secondary }: { primary: ReactNode; secondary?: ReactNode }) {
  return (
    <>
      <span className="block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-fg">{primary}</span>
      {secondary ? <span className="mt-0.5 block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-dim">{secondary}</span> : null}
    </>
  );
}
