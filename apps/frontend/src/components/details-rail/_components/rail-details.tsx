import { useState, type ReactNode } from "react";

export function RailDetails({ children, open, summary, onToggle }: { children: ReactNode; open?: boolean; summary: string; onToggle?: (open: boolean) => void }) {
  const [isOpen, setIsOpen] = useState(open ?? false);
  return (
    <details
      className="border-b border-line p-3"
      onToggle={(event) => {
        setIsOpen(event.currentTarget.open);
        onToggle?.(event.currentTarget.open);
      }}
      open={isOpen}
    >
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
