import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(
        "flex min-h-24 w-full rounded-md border border-white/[0.08] bg-[#1a1f2e] px-2.5 py-2 text-sm text-slate-200 placeholder:text-slate-500 shadow-xs transition-all duration-150 outline-none",
        "focus-visible:border-cyan-400/40 focus-visible:ring-2 focus-visible:ring-cyan-400/15",
        "disabled:cursor-not-allowed disabled:opacity-40",
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
