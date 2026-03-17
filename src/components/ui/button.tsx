"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost" | "destructive" | "accent";
  size?: "default" | "sm" | "lg" | "icon";
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant = "default", size = "default", asChild = false, ...props },
    ref
  ) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:opacity-40",
          {
            "bg-foreground text-background hover:bg-foreground/90":
              variant === "default",
            "border border-border bg-transparent text-foreground hover:bg-surface-hover hover:border-border-hover":
              variant === "outline",
            "text-muted-foreground hover:bg-surface-hover hover:text-foreground":
              variant === "ghost",
            "bg-red/10 text-red hover:bg-red/20":
              variant === "destructive",
            "bg-accent text-accent-foreground font-semibold hover:bg-accent-dim":
              variant === "accent",
          },
          {
            "h-10 px-5 py-2.5": size === "default",
            "h-9 rounded-lg px-4 text-sm": size === "sm",
            "h-11 rounded-lg px-7 text-base": size === "lg",
            "h-10 w-10": size === "icon",
          },
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button };
