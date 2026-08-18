interface P { darkMode: boolean }

const sk = (dm: boolean) => dm ? 'skeleton' : 'skeleton-light'

export function SkeletonSearchBar({ darkMode }: P) {
  return <div className={`h-12 rounded-xl w-full ${sk(darkMode)}`} />
}

export function SkeletonChips({ darkMode }: P) {
  return (
    <div className="flex gap-2">
      {[80, 92, 76, 104, 86, 72, 88].map((w, i) => (
        <div key={i} className={`h-8 rounded-full flex-shrink-0 ${sk(darkMode)}`} style={{ width: w }} />
      ))}
    </div>
  )
}

export function SkeletonPlaceCard({ darkMode: dm }: P) {
  const row = (w: string) => <div className={`h-3 rounded-full ${sk(dm)}`} style={{ width: w }} />
  return (
    <div
      className="rounded-2xl overflow-hidden w-[340px]"
      style={{ background: dm ? '#0a1628' : '#fff', border: `1px solid ${dm ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'}` }}
    >
      <div className={`h-40 ${sk(dm)}`} />
      <div className="p-4 space-y-3">
        {row('30%')}
        {row('62%')}
        <div className="flex gap-4">{row('22%')}{row('18%')}</div>
        {row('88%')}
        {row('75%')}
        <div className="flex gap-2 mt-2">
          <div className={`h-10 rounded-xl flex-1 ${sk(dm)}`} />
          <div className={`h-10 w-10 rounded-xl ${sk(dm)}`} />
        </div>
      </div>
    </div>
  )
}

export function SkeletonMap({ darkMode: dm }: P) {
  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center gap-4"
      style={{ background: dm ? '#070f1f' : '#e8eaed', fontFamily: 'Inter, sans-serif' }}
    >
      <div className="relative flex items-center justify-center">
        {/* Pulsing rings */}
        <div className="absolute w-20 h-20 rounded-full animate-ping" style={{ background: 'rgba(255,153,51,0.08)' }} />
        <div className="absolute w-14 h-14 rounded-full animate-pulse" style={{ background: 'rgba(255,153,51,0.12)' }} />
        <div
          className="relative w-9 h-9 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: '#FF9933', borderTopColor: 'transparent' }}
        />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium" style={{ color: dm ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.45)' }}>
          Loading Suraksha Setu
        </p>
        <p className="text-xs mt-1" style={{ color: dm ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.28)' }}>
          Preparing your safety map...
        </p>
      </div>
    </div>
  )
}

export function SkeletonProfile({ darkMode: dm }: P) {
  return (
    <div className="flex items-center gap-2.5">
      <div className={`w-8 h-8 rounded-full ${sk(dm)}`} />
      <div className="space-y-1.5">
        <div className={`h-3 w-20 rounded-full ${sk(dm)}`} />
        <div className={`h-2.5 w-14 rounded-full ${sk(dm)}`} />
      </div>
    </div>
  )
}
