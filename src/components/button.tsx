import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all duration-150 disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none cursor-pointer focus-visible:ring-2 focus-visible:ring-cyan-400/30",
  {
    variants: {
      variant: {
        default:
          "bg-cyan-500 text-white hover:bg-cyan-400 active:bg-cyan-600 shadow-sm",
        destructive:
          "bg-rose-500/15 text-rose-400 border border-rose-500/20 hover:bg-rose-500/25",
        outline:
          "border border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/[0.08] hover:border-white/15 hover:text-white",
        secondary:
          "bg-white/[0.06] text-slate-300 hover:bg-white/[0.1] hover:text-white",
        ghost:
          "text-slate-400 hover:bg-white/[0.06] hover:text-white",
        link: "text-cyan-400 underline-offset-4 hover:underline hover:text-cyan-300",
      },
      size: {
        default: "h-8 px-3.5 py-1.5 text-[13px] has-[>svg]:px-2.5",
        sm: "h-7 rounded-md gap-1.5 px-2.5 text-xs has-[>svg]:px-2",
        lg: "h-9 rounded-md px-5 has-[>svg]:px-3.5",
        icon: "size-8 rounded-md",
        "icon-sm": "size-7 rounded-md",
        "icon-lg": "size-9 rounded-md",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
