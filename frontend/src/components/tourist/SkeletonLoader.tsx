interface P { darkMode: boolean }

const sk = (dm: boolean) => (dm ? 'skeleton' : 'skeleton-light');

export function SkeletonMap({ darkMode: dm }: P) {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-4" style={{ background: dm ? '#09090b' : '#e8eaed', fontFamily: 'Inter, sans-serif' }}>
      <div className="relative flex items-center justify-center">
        <div className="absolute w-20 h-20 rounded-full animate-ping" style={{ background: 'rgba(255,153,51,0.08)' }} />
        <div className="absolute w-14 h-14 rounded-full animate-pulse" style={{ background: 'rgba(255,153,51,0.12)' }} />
        <div className="relative w-9 h-9 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: '#FF9933', borderTopColor: 'transparent' }} />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium" style={{ color: dm ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.45)' }}>Loading Suraksha Setu</p>
        <p className="text-xs mt-1" style={{ color: dm ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.28)' }}>Restoring your session...</p>
      </div>
    </div>
  );
}

export function SkeletonList({ darkMode: dm, rows = 4 }: P & { rows?: number }) {
  return (
    <div className="space-y-2.5 px-4 py-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={`h-16 rounded-xl ${sk(dm)}`} />
      ))}
    </div>
  );
}
