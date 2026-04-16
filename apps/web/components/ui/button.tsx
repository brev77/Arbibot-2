import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 html.theme-light:focus-visible:ring-offset-slate-50',
  {
    variants: {
      variant: {
        default:
          'border border-slate-600 bg-slate-800 text-slate-100 hover:bg-slate-700 html.theme-light:border-slate-300 html.theme-light:bg-slate-100 html.theme-light:text-slate-900 html.theme-light:hover:bg-slate-200',
        secondary:
          'border border-slate-600 bg-transparent text-slate-200 hover:bg-slate-800/80 html.theme-light:border-slate-300 html.theme-light:text-slate-800 html.theme-light:hover:bg-slate-100',
        ghost:
          'border border-transparent text-slate-200 hover:bg-slate-800/60 html.theme-light:text-slate-800 html.theme-light:hover:bg-slate-200/80',
        destructive:
          'border border-red-900/60 bg-red-950/50 text-red-100 hover:bg-red-950/80 html.theme-light:border-red-200 html.theme-light:bg-red-50 html.theme-light:text-red-900 html.theme-light:hover:bg-red-100',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    readonly asChild?: boolean;
  };

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
