import type { ComponentProps, ReactNode } from "react";

type ButtonTone = "default" | "primary" | "warning";

const buttonTone: Record<ButtonTone, string> = {
  default: "border-[#d0d7de] bg-[#f6f8fa] hover:bg-[#f3f4f6]",
  primary: "border-[#0969da] bg-[#0969da] text-white hover:bg-[#0550ae]",
  warning: "border-[#d4a72c] bg-[#fff8c5] text-[#7d4e00] hover:bg-[#fae17d]",
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
      className={`inline-flex min-h-8 items-center justify-center gap-1.5 rounded-[5px] border px-2.5 py-1 text-[#24292f] disabled:cursor-not-allowed disabled:opacity-55 ${buttonTone[tone]} ${className}`}
      {...props}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}
