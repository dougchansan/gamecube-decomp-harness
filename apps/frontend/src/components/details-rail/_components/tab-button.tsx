import type { ReactNode } from "react";

export function TabButton({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button
      aria-selected={active}
      className={`min-h-8 rounded-none border px-2.5 py-1 text-xs font-bold uppercase ${
        active ? "border-line2 bg-raised text-fg" : "border-line bg-card text-dim hover:border-line2 hover:text-soft"
      }`}
      onClick={onClick}
      role="tab"
      type="button"
    >
      {children}
    </button>
  );
}
