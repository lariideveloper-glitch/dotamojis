import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium tracking-wide",
  {
    variants: {
      variant: {
        default:
          "bg-cyan-400/10 text-cyan-300 border border-cyan-400/15",
        subtle:
          "bg-white/[0.04] text-slate-400 border border-white/[0.06]",
        warn:
          "bg-amber-400/10 text-amber-300 border border-amber-400/15",
        danger:
          "bg-rose-400/10 text-rose-300 border border-rose-400/15",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
  VariantProps<typeof badgeVariants> { }

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
