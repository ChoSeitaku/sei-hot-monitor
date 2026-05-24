export function FloatingParticles() {
  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden" aria-hidden="true">
      <div className="bg-dot-grid absolute inset-0" />
      <div className="absolute top-1/4 -left-32 w-96 h-96 rounded-full blur-[128px] opacity-[0.03]"
           style={{ background: 'radial-gradient(circle, #06b6d4, transparent)' }} />
      <div className="absolute bottom-1/4 -right-32 w-96 h-96 rounded-full blur-[128px] opacity-[0.03]"
           style={{ background: 'radial-gradient(circle, #6366f1, transparent)' }} />
      <div className="absolute inset-0 bg-scan-line opacity-30 animate-[scan-line_8s_linear_infinite]" />
    </div>
  );
}
