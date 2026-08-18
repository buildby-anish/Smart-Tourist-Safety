import { useState } from 'react'
import { Phone, X, AlertTriangle, Loader2 } from 'lucide-react'

interface Props { onTrigger: () => void }

export default function SOSButton({ onTrigger }: Props) {
  const [stage, setStage] = useState<'idle' | 'confirm' | 'sending'>('idle')

  const start = () => setStage('confirm')

  const send = () => {
    setStage('sending')
    setTimeout(() => {
      setStage('idle')
      onTrigger()
    }, 1800)
  }

  return (
    <>
      {/* Confirm overlay */}
      {stage !== 'idle' && (
        <>
          <div
            className="fixed inset-0 z-[60] animate-fade-in"
            style={{ background: 'rgba(7,15,31,0.7)', backdropFilter: 'blur(6px)' }}
            onClick={() => stage === 'confirm' && setStage('idle')}
          />
          <div
            className="fixed inset-0 z-[61] flex items-center justify-center p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="w-full max-w-sm rounded-2xl p-6 animate-modal-in"
              style={{ background: '#0a1628', border: '1px solid rgba(220,38,38,0.25)', boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}
            >
              <div className="flex items-start gap-4 mb-6">
                <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(220,38,38,0.12)' }}>
                  <AlertTriangle size={22} style={{ color: '#dc2626' }} />
                </div>
                <div>
                  <h3 className="text-white font-semibold text-[17px] mb-1.5">Emergency SOS</h3>
                  <p className="text-[rgba(255,255,255,0.52)] text-sm leading-relaxed">
                    This will immediately alert local authorities and your emergency contacts. Only use in a genuine emergency.
                  </p>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStage('idle')}
                  disabled={stage === 'sending'}
                  className="flex-1 h-11 rounded-xl text-sm font-medium text-[rgba(255,255,255,0.65)] border border-[rgba(255,255,255,0.1)] hover:bg-[rgba(255,255,255,0.05)] transition-colors disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  onClick={send}
                  disabled={stage === 'sending'}
                  className="flex-1 h-11 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-70"
                  style={{ background: '#dc2626', boxShadow: '0 4px 20px rgba(220,38,38,0.45)' }}
                >
                  {stage === 'sending' ? (
                    <><Loader2 size={15} className="animate-spin" /> Sending...</>
                  ) : (
                    <><Phone size={15} /> Send SOS</>
                  )}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* The button itself */}
      <button
        onClick={start}
        className="w-14 h-14 rounded-full flex items-center justify-center transition-all duration-150 hover:scale-105 active:scale-95 select-none"
        style={{
          background: 'linear-gradient(145deg, #ef4444, #b91c1c)',
          boxShadow: '0 4px 20px rgba(220,38,38,0.55), 0 0 0 3px rgba(220,38,38,0.18)',
        }}
        aria-label="Emergency SOS"
      >
        <span className="text-white font-extrabold text-[13px] tracking-tight">SOS</span>
      </button>
    </>
  )
}
