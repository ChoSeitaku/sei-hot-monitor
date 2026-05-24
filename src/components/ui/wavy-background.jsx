import { useRef, useEffect, useState } from 'react';
import { cn } from '../../lib/utils';

export function WavyBackground({
  children,
  className,
  containerClassName,
  colors = ['#06b6d4', '#6366f1', '#22d3ee', '#818cf8'],
  waveWidth = 80,
  backgroundFill = '#050510',
  blur = 4,
  speed = 'slow',
  waveOpacity = 0.4,
  ...props
}) {
  const canvasRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const animRef = useRef(0);
  const timeRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const resize = () => {
      const w = window.innerWidth;
      const h = canvas.parentElement?.offsetHeight || 320;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.scale(dpr, dpr);
      setDimensions({ width: w, height: h });
    };

    resize();
    window.addEventListener('resize', resize);

    const speedFactor = speed === 'fast' ? 0.0015 : 0.0006;
    const animate = () => {
      timeRef.current += speedFactor;
      const { width, height } = dimensions;
      if (!width || !height) {
        animRef.current = requestAnimationFrame(animate);
        return;
      }

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = backgroundFill;
      ctx.fillRect(0, 0, width, height);

      const waveCount = colors.length;
      for (let w = 0; w < waveCount; w++) {
        const color = colors[w];
        ctx.beginPath();
        const baseY = height * (0.3 + (w / waveCount) * 0.4);
        const amplitude = 20 + w * 8;

        for (let x = 0; x <= width; x += 2) {
          const y = baseY + Math.sin(x * (0.003 + w * 0.001) + timeRef.current * (1 + w * 0.5)) * amplitude
                    + Math.sin(x * 0.001 + timeRef.current * 0.7) * (amplitude * 0.4);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }

        ctx.lineTo(width, height);
        ctx.lineTo(0, height);
        ctx.closePath();

        const grad = ctx.createLinearGradient(0, baseY - amplitude, 0, height);
        grad.addColorStop(0, color + Math.floor(waveOpacity * 255).toString(16).padStart(2, '0'));
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.fill();
      }

      ctx.filter = `blur(${blur}px)`;
      ctx.globalCompositeOperation = 'screen';
      ctx.fill();
      ctx.filter = 'none';
      ctx.globalCompositeOperation = 'source-over';

      animRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [colors, waveWidth, speed, waveOpacity, blur, backgroundFill, dimensions]);

  return (
    <div className={cn('relative overflow-hidden', containerClassName)} {...props}>
      <canvas ref={canvasRef} className="absolute inset-0 z-0" />
      <div className={cn('relative z-10', className)}>
        {children}
      </div>
    </div>
  );
}
