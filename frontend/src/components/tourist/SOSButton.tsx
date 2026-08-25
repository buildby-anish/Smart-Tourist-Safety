import { useState } from 'react'
import { Phone, X, AlertTriangle, Loader2, CheckCircle2 } from 'lucide-react'

interface Props {
  /** Performs the real SOS submission (location capture, offline queue,
   * backend POST). Resolves with a short status message on success/queued,
   * or throws an Error with a message to show the user. */
  onTrigger: () => Promise<string>
}

export default function SOSButton({ onTrigger }: Props) {
  const [stage, setStage] = useState<'idle' | 'confirm' | 'sending' | 'success' | 'error'>('idle')
  const [resultMsg, setResultMsg] = useState('')

  const start = () => setStage('confirm')

  const send = async () => {
    setStage('sending')
    try {
      const msg = await onTrigger()
      setResultMsg(msg)
      setStage('success')
      setTimeout(() => setStage('idle'), 2200)
    } catch (err: any) {
      setResultMsg(err?.message || 'Could not send SOS. Please try again or call emergency services directly.')
      setStage('error')
    }
  }

  return (
    <>
      {/* Confirm / status overlay */}
      {stage !== 'idle' && (
        <>
          <div
            className="fixed inset-0 z-[60] animate-fade-in"
            style={{ background: 'rgba(18,18,18,0.7)', backdropFilter: 'blur(6px)' }}
            onClick={() => stage === 'confirm' && setStage('idle')}
          />
          <div
            className="fixed inset-0 z-[61] flex items-center justify-center p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="w-full max-w-sm rounded-2xl p-6 animate-modal-in"
              style={{ background: '#18181b', border: '1px solid rgba(220,38,38,0.25)', boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}
            >
              {(stage === 'confirm' || stage === 'sending') && (
                <>
                  <div className="flex items-start gap-4 mb-6">
                    <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(220,38,38,0.12)' }}>
                      <AlertTriangle size={22} style={{ color: '#dc2626' }} />
                    </div>
                    <div>
                      <h3 className="text-white font-semibold text-[17px] mb-1.5">Emergency SOS</h3>
                      <p className="text-[rgba(255,255,255,0.52)] text-sm leading-relaxed">
                        This will immediately alert local authorities with your location. Only use in a genuine emergency.
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
                </>
              )}

              {stage === 'success' && (
                <div className="flex flex-col items-center text-center gap-3 py-2">
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(19,136,8,0.12)' }}>
                    <CheckCircle2 size={22} style={{ color: '#138808' }} />
                  </div>
                  <h3 className="text-white font-semibold text-[16px]">SOS sent</h3>
                  <p className="text-[rgba(255,255,255,0.55)] text-sm leading-relaxed">{resultMsg}</p>
                </div>
              )}

              {stage === 'error' && (
                <div className="flex flex-col items-center text-center gap-3 py-2">
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(220,38,38,0.12)' }}>
                    <AlertTriangle size={22} style={{ color: '#dc2626' }} />
                  </div>
                  <h3 className="text-white font-semibold text-[16px]">Couldn't send SOS</h3>
                  <p className="text-[rgba(255,255,255,0.55)] text-sm leading-relaxed">{resultMsg}</p>
                  <div className="flex gap-3 w-full mt-2">
                    <button onClick={() => setStage('idle')} className="flex-1 h-10 rounded-xl text-sm font-medium text-[rgba(255,255,255,0.65)] border border-[rgba(255,255,255,0.1)]">Close</button>
                    <a href="tel:100" className="flex-1 h-10 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2" style={{ background: '#dc2626' }}>
                      <Phone size={14} /> Call 100
                    </a>
                  </div>
                </div>
              )}
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
