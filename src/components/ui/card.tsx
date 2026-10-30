import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("glass-card rounded-2xl", className)} {...props} />;
}

export function CardHeader({
  title,
  description,
  action,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const slot = action ?? actions;
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-border/80 px-5 py-4", className)}>
      <div className="min-w-0">
        <h2 className="text-[15.5px] font-semibold tracking-tight text-foreground">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
      </div>
      {slot && <div className="flex shrink-0 flex-wrap items-center gap-2">{slot}</div>}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}
