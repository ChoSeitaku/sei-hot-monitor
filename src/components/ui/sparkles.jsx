import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';

export function Sparkles({
  children,
  className,
  particleColor = '#06b6d4',
  particleCount = 12,
  minSize = 1,
  maxSize = 3,
}) {
  const particles = useMemo(() =>
    Array.from({ length: particleCount }, (_, i) => ({
      id: i,
      x: 5 + Math.random() * 90,
      y: 5 + Math.random() * 90,
      size: minSize + Math.random() * (maxSize - minSize),
      duration: 0.8 + Math.random() * 1.6,
      delay: Math.random() * 2.5,
    })), [particleCount, minSize, maxSize]);

  return (
    <div className={cn('relative inline-block', className)}>
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full pointer-events-none"
          style={{
            width: p.size,
            height: p.size,
            left: `${p.x}%`,
            top: `${p.y}%`,
            background: particleColor,
            boxShadow: `0 0 ${p.size * 2}px ${particleColor}`,
          }}
          animate={{
            opacity: [0, 1, 0],
            scale: [0, 1.5, 1.5],
            y: [0, -20, -20],
          }}
          transition={{
            duration: p.duration,
            delay: p.delay,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      ))}
      {children}
    </div>
  );
}
