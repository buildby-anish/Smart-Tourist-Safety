import { useState, useRef, KeyboardEvent, useEffect } from 'react'
import {
  X, ChevronRight, AlertCircle, CheckCircle2,
  Loader2, Phone, Hash, ArrowLeft, Wifi, WifiOff,
  Shield,
} from 'lucide-react'

type Step = 'credentials' | 'otp' | 'verifying' | 'success' | 'error'
type FieldErrors = { touristId?: string; phone?: string; otp?: string }

interface Props {
  onClose: () => void
  onAuthenticated: (touristId: string) => void
  darkMode: boolean
}

export default function LoginModal({ onClose, onAuthenticated, darkMode: dm }: Props) {
  const [step, setStep]         = useState<Step>('credentials')
  const [touristId, setId]      = useState('')
  const [phone, setPhone]       = useState('')
  const [otp, setOtp]           = useState<string[]>(Array(6).fill(''))
  const [errs, setErrs]         = useState<FieldErrors>({})
  const [generalErr, setGenErr] = useState('')
  const [loading, setLoading]   = useState(false)
  const [resend, setResend]     = useState(0)
  const otpRefs = useRef<(HTMLInputElement | null)[]>([])
  const resendTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => () => { if (resendTimer.current) clearInterval(resendTimer.current) }, [])

  const surface  = dm ? '#0a1628' : '#ffffff'
  const border   = dm ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
  const text     = dm ? '#f1f5f9' : '#0c2340'
  const subtle   = dm ? 'rgba(255,255,255,0.45)' : 'rgba(12,35,64,0.45)'
  const fieldBg  = dm ? 'rgba(255,255,255,0.05)' : '#f8fafc'
  const fieldBd  = dm ? 'rgba(255,255,255,0.11)' : '#e2e8f0'
  const label    = dm ? 'rgba(255,255,255,0.68)' : 'rgba(12,35,64,0.68)'

  const startResend = () => {
    setResend(30)
    resendTimer.current = setInterval(() => {
      setResend((r) => {
        if (r <= 1) { clearInterval(resendTimer.current!); resendTimer.current = null; return 0 }
        return r - 1
      })
    }, 1000)
  }

  const validate = () => {
    const e: FieldErrors = {}
    if (!touristId.trim()) e.touristId = 'Tourist ID is required'
    else if (touristId.trim().length < 3) e.touristId = 'Enter a valid Tourist ID'
    if (!phone.trim()) e.phone = 'Phone number is required'
    else if (!/^\+?[\d\s\-]{10,14}$/.test(phone)) e.phone = 'Enter a valid Indian mobile number'
    setErrs(e)
    return !Object.keys(e).length
  }

  const handleContinue = async () => {
    if (!validate()) return
    setLoading(true); setGenErr('')
    await new Promise((r) => setTimeout(r, 1100))
    setLoading(false)
    if (touristId.trim().toUpperCase() === 'INVALID') {
      setGenErr('Tourist ID not registered. Please check your ID or contact the tourism office.')
      return
    }
    if (touristId.trim().toUpperCase() === 'NETERR') {
      setGenErr('Network error. Check your connection and try again.')
      return
    }
    setStep('otp')
    startResend()
    setTimeout(() => otpRefs.current[0]?.focus(), 80)
  }

  const handleOtp = (i: number, val: string) => {
    if (!/^[0-9]?$/.test(val)) return
    const next = [...otp]; next[i] = val; setOtp(next)
    setErrs((e) => ({ ...e, otp: undefined }))
    if (val && i < 5) otpRefs.current[i + 1]?.focus()
  }

  const handleOtpKey = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otp[i] && i > 0) otpRefs.current[i - 1]?.focus()
    if (e.key === 'ArrowLeft' && i > 0) otpRefs.current[i - 1]?.focus()
    if (e.key === 'ArrowRight' && i < 5) otpRefs.current[i + 1]?.focus()
  }

  const handleVerify = async () => {
    const code = otp.join('')
    if (code.length < 6) { setErrs({ otp: 'Enter all 6 digits' }); return }
    setStep('verifying')
    await new Promise((r) => setTimeout(r, 1600))
    if (code === '000000') {
      setStep('otp')
      setErrs({ otp: 'Invalid verification code. Please try again.' })
      return
    }
    setStep('success')
    setTimeout(() => onAuthenticated(touristId.trim()), 1000)
  }

  const handleResend = () => {
    setOtp(Array(6).fill(''))
    setErrs({})
    startResend()
    setTimeout(() => otpRefs.current[0]?.focus(), 80)
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[50] animate-fade-in"
        style={{ background: 'rgba(7,15,31,0.72)', backdropFilter: 'blur(10px)' }}
        onClick={step === 'credentials' || step === 'otp' ? onClose : undefined}
      />

      {/* Sheet / Modal */}
      <div className="fixed inset-0 z-[51] flex items-end sm:items-center justify-center sm:p-5">
        <div
          className="w-full sm:max-w-[400px] rounded-t-[24px] sm:rounded-2xl overflow-hidden animate-sheet-up sm:animate-modal-in"
          style={{
            background: surface,
            border: `1px solid ${border}`,
            boxShadow: `0 24px 80px rgba(0,0,0,${dm ? '0.6' : '0.25'})`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Mobile handle */}
          <div className="sm:hidden flex justify-center pt-3 pb-0">
            <div className="w-9 h-1 rounded-full" style={{ background: dm ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.1)' }} />
          </div>

          <div className="px-6 pt-5 pb-6" style={{ paddingBottom: 'max(24px,env(safe-area-inset-bottom,24px))' }}>
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: '#0c2340' }}>
                  <Shield size={16} style={{ color: '#FF9933' }} strokeWidth={2.5} />
                </div>
                <div>
                  <p className="text-[15px] font-bold leading-none" style={{ color: text, fontFamily: 'Outfit, sans-serif' }}>
                    {step === 'credentials' && 'Sign in'}
                    {step === 'otp'         && 'Verify identity'}
                    {step === 'verifying'   && 'Verifying...'}
                    {step === 'success'     && 'Welcome back'}
                    {step === 'error'       && 'Connection error'}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: subtle }}>
                    {step === 'credentials' && 'Suraksha Setu Tourist Safety'}
                    {step === 'otp'         && `Code sent to ${phone}`}
                    {step === 'verifying'   && 'Just a moment...'}
                    {step === 'success'     && 'Returning to map'}
                    {step === 'error'       && 'Check your connection'}
                  </p>
                </div>
              </div>
              {(step === 'credentials' || step === 'otp') && (
                <button
                  onClick={onClose}
                  className="w-8 h-8 rounded-full flex items-center justify-center transition-opacity hover:opacity-70"
                  style={{ background: dm ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}
                  aria-label="Close"
                >
                  <X size={15} style={{ color: subtle }} />
                </button>
              )}
            </div>

            {/* ── Credentials ── */}
            {step === 'credentials' && (
              <div className="space-y-4">
                {generalErr && (
                  <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl animate-fade-in"
                    style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)' }}>
                    <AlertCircle size={14} style={{ color: '#ef4444', flexShrink: 0, marginTop: 1 }} />
                    <p className="text-xs leading-relaxed" style={{ color: '#f87171' }}>{generalErr}</p>
                  </div>
                )}

                <Field
                  label="Tourist ID"
                  placeholder="e.g. TID-2024-XXXXX"
                  value={touristId}
                  onChange={(v) => { setId(v); setErrs((e) => ({ ...e, touristId: undefined })); setGenErr('') }}
                  error={errs.touristId}
                  icon={<Hash size={15} />}
                  bg={fieldBg} bd={fieldBd} text={text} subtle={subtle} label={label} dm={dm}
                  autoCapitalize="characters"
                />

                <Field
                  label="Registered phone number"
                  placeholder="+91 98765 43210"
                  value={phone}
                  type="tel"
                  onChange={(v) => { setPhone(v); setErrs((e) => ({ ...e, phone: undefined })); setGenErr('') }}
                  error={errs.phone}
                  icon={<Phone size={15} />}
                  bg={fieldBg} bd={fieldBd} text={text} subtle={subtle} label={label} dm={dm}
                />

                <button
                  onClick={handleContinue}
                  disabled={loading}
                  className="w-full h-12 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2.5 mt-1 transition-all hover:opacity-92 active:scale-[0.98] disabled:opacity-60"
                  style={{ background: '#FF9933', boxShadow: '0 4px 20px rgba(255,153,51,0.35)' }}
                >
                  {loading
                    ? <><Loader2 size={16} className="animate-spin" /> Sending OTP...</>
                    : <> Continue <ChevronRight size={16} /></>
                  }
                </button>

                <p className="text-center text-[11px]" style={{ color: subtle }}>
                  By continuing you agree to our{' '}
                  <span className="text-[#FF9933] cursor-pointer hover:underline">Terms of Service</span>
                  {' '}and{' '}
                  <span className="text-[#FF9933] cursor-pointer hover:underline">Privacy Policy</span>
                </p>
              </div>
            )}

            {/* ── OTP ── */}
            {step === 'otp' && (
              <div className="space-y-5">
                <p className="text-sm leading-relaxed" style={{ color: subtle }}>
                  Enter the 6-digit code sent to your registered phone number to verify your identity.
                </p>

                <div>
                  <div className="flex gap-2 justify-between">
                    {otp.map((d, i) => (
                      <input
                        key={i}
                        ref={(el) => { otpRefs.current[i] = el }}
                        type="text"
                        inputMode="numeric"
                        maxLength={1}
                        value={d}
                        onChange={(e) => handleOtp(i, e.target.value)}
                        onKeyDown={(e) => handleOtpKey(i, e)}
                        className="otp-box"
                        style={{
                          background: dm ? (d ? 'rgba(255,153,51,0.08)' : 'rgba(255,255,255,0.05)') : (d ? 'rgba(255,153,51,0.05)' : '#f8fafc'),
                          border: `1.5px solid ${errs.otp ? '#dc2626' : d ? 'rgba(255,153,51,0.45)' : (dm ? 'rgba(255,255,255,0.12)' : '#e2e8f0')}`,
                          color: text,
                        }}
                        aria-label={`Digit ${i + 1} of 6`}
                      />
                    ))}
                  </div>
                  {errs.otp && (
                    <p className="text-xs mt-2.5 flex items-center gap-1.5 animate-fade-in" style={{ color: '#ef4444' }}>
                      <AlertCircle size={12} />{errs.otp}
                    </p>
                  )}
                </div>

                {/* Demo hint */}
                <div className="px-3 py-2.5 rounded-xl text-xs" style={{ background: dm ? 'rgba(255,153,51,0.07)' : 'rgba(255,153,51,0.05)', border: '1px solid rgba(255,153,51,0.15)', color: subtle }}>
                  Demo: enter any 6 digits (except 000000) to continue.
                </div>

                <button
                  onClick={handleVerify}
                  disabled={otp.join('').length < 6}
                  className="w-full h-12 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2.5 transition-all hover:opacity-92 active:scale-[0.98] disabled:opacity-35"
                  style={{ background: '#FF9933', boxShadow: '0 4px 20px rgba(255,153,51,0.35)' }}
                >
                  Verify & Continue
                </button>

                <div className="flex items-center justify-between">
                  <button
                    onClick={() => { setStep('credentials'); setOtp(Array(6).fill('')); setErrs({}); setGenErr('') }}
                    className="flex items-center gap-1.5 text-xs transition-opacity hover:opacity-70"
                    style={{ color: subtle }}
                  >
                    <ArrowLeft size={13} /> Change details
                  </button>
                  {resend > 0
                    ? <span className="text-xs" style={{ color: subtle }}>Resend in {resend}s</span>
                    : <button onClick={handleResend} className="text-xs font-semibold text-[#FF9933] hover:underline">Resend OTP</button>
                  }
                </div>
              </div>
            )}

            {/* ── Verifying ── */}
            {step === 'verifying' && (
              <div className="flex flex-col items-center py-8 gap-4 animate-fade-in">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(255,153,51,0.1)' }}>
                  <Loader2 size={30} style={{ color: '#FF9933' }} className="animate-spin" />
                </div>
                <div className="text-center">
                  <p className="font-semibold text-[15px]" style={{ color: text }}>Verifying your identity</p>
                  <p className="text-sm mt-1" style={{ color: subtle }}>Checking with the Tourism Authority...</p>
                </div>
              </div>
            )}

            {/* ── Success ── */}
            {step === 'success' && (
              <div className="flex flex-col items-center py-8 gap-4 animate-fade-in">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(19,136,8,0.1)' }}>
                  <CheckCircle2 size={30} style={{ color: '#138808' }} />
                </div>
                <div className="text-center">
                  <p className="font-semibold text-[15px]" style={{ color: text }}>Identity verified</p>
                  <p className="text-sm mt-1" style={{ color: subtle }}>Taking you back to the map...</p>
                </div>
              </div>
            )}

            {/* ── Error ── */}
            {step === 'error' && (
              <div className="flex flex-col items-center py-8 gap-4 animate-fade-in">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(220,38,38,0.08)' }}>
                  <WifiOff size={30} style={{ color: '#dc2626' }} />
                </div>
                <div className="text-center">
                  <p className="font-semibold text-[15px]" style={{ color: text }}>Connection error</p>
                  <p className="text-sm mt-1 max-w-[240px]" style={{ color: subtle }}>Check your network connection and try again.</p>
                </div>
                <button
                  onClick={() => { setStep('credentials'); setGenErr('') }}
                  className="mt-2 h-11 px-6 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-92 active:scale-95"
                  style={{ background: '#FF9933' }}
                >
                  Try again
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

function Field({
  label: lbl, placeholder, value, onChange, error, icon,
  bg, bd, text, subtle, label: labelC, dm, type = 'text', autoCapitalize,
}: {
  label: string; placeholder: string; value: string; onChange: (v: string) => void;
  error?: string; icon: React.ReactNode; bg: string; bd: string;
  text: string; subtle: string; label: string; dm: boolean;
  type?: string; autoCapitalize?: string;
}) {
  const [focused, setFocused] = useState(false)
  return (
    <div>
      <label className="text-xs font-medium mb-1.5 block" style={{ color: labelC }}>{lbl}</label>
      <div
        className="flex items-center gap-2.5 px-3.5 h-12 rounded-xl transition-all duration-150"
        style={{
          background: bg,
          border: `1.5px solid ${error ? '#dc2626' : focused ? '#FF9933' : bd}`,
          boxShadow: focused ? `0 0 0 3px rgba(255,153,51,0.12)` : 'none',
        }}
      >
        <span style={{ color: focused ? '#FF9933' : subtle, transition: 'color 0.15s', flexShrink: 0 }}>{icon}</span>
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          autoCapitalize={autoCapitalize}
          className="flex-1 bg-transparent text-sm outline-none"
          style={{ color: text, fontFamily: 'Inter, sans-serif' }}
          aria-invalid={!!error}
        />
      </div>
      {error && (
        <p className="text-xs mt-1.5 flex items-center gap-1.5 animate-fade-in" style={{ color: '#ef4444' }}>
          <AlertCircle size={12} />{error}
        </p>
      )}
    </div>
  )
}
