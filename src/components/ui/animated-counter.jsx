import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';

export function AnimatedCounter({ value, label, suffix = '', className }) {
  const [display, setDisplay] = useState(0);
  const prevRef = useRef(0);

  useEffect(() => {
    const prev = prevRef.current;
    if (value === prev) {
      setDisplay(value);
      return;
    }
    prevRef.current = value;

    const diff = value - prev;
    const steps = 15;
    const duration = 400;
    const stepTime = duration / steps;

    let current = prev;
    const timer = setInterval(() => {
      current += diff / steps;
      if ((diff > 0 && current >= value) || (diff < 0 && current <= value)) {
        setDisplay(value);
        clearInterval(timer);
      } else {
        setDisplay(Math.round(current));
      }
    }, stepTime);

    return () => clearInterval(timer);
  }, [value]);

  return (
    <div className={cn('stat-card', className)}>
      <span className="text-2xl md:text-3xl font-bold text-gradient font-mono tabular-nums">
        {display}{suffix}
      </span>
      <span className="text-xs text-slate-500">{label}</span>
    </div>
  );
}
