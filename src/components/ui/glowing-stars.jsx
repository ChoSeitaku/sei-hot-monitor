import { useId } from 'react';
import { motion } from 'framer-motion';
import { cn } from '../../lib/utils';

export function GlowingStarsCard({ children, className }) {
  const id = useId();

  const stars = Array.from({ length: 20 }, (_, i) => ({
    id: i,
    cx: Math.random() * 100,
    cy: Math.random() * 100,
    r: 1 + Math.random() * 2,
    duration: 2 + Math.random() * 4,
    delay: Math.random() * 2,
  }));

  return (
    <div className={cn('relative overflow-hidden group', className)}>
      {/* Background stars */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none opacity-30 group-hover:opacity-70 transition-opacity duration-700"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <radialGradient id={`glow-${id}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(6,182,212,0.3)" />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
        </defs>
        {stars.map((star) => (
          <motion.circle
            key={star.id}
            cx={`${star.cx}%`}
            cy={`${star.cy}%`}
            r={star.r}
            fill="rgba(6,182,212,0.4)"
            animate={{
              opacity: [0.2, 0.8, 0.2],
              r: [star.r, star.r * 1.8, star.r],
            }}
            transition={{
              duration: star.duration,
              delay: star.delay,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
          />
        ))}
        {/* Central glow */}
        <motion.circle
          cx="50%"
          cy="50%"
          r="30%"
          fill={`url(#glow-${id})`}
          animate={{
            opacity: [0, 0.3, 0],
            scale: [0.8, 1.2, 0.8],
          }}
          transition={{
            duration: 4,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      </svg>
      <div className="relative z-10">{children}</div>
    </div>
  );
}
