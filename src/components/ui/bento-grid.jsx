import { cn } from '../../lib/utils';

export function BentoGrid({ children, className }) {
  return (
    <div className={cn('grid grid-cols-1 md:grid-cols-2 gap-4', className)}>
      {children}
    </div>
  );
}

export function BentoGridItem({ children, className, span = 1 }) {
  const spanClass = span > 1 ? `md:col-span-${span}` : '';
  return (
    <div className={cn('glass-card p-5', spanClass, className)}>
      {children}
    </div>
  );
}
