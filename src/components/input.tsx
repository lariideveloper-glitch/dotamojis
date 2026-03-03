import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-md border border-white/[0.08] bg-[#1a1f2e] px-2.5 py-1 text-sm text-slate-200 placeholder:text-slate-500 shadow-xs transition-all duration-150 outline-none",
        "focus-visible:border-cyan-400/40 focus-visible:ring-2 focus-visible:ring-cyan-400/15",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
