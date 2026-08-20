import { useState, useRef, KeyboardEvent, useEffect } from 'react';
import {
  X, ChevronRight, AlertCircle, CheckCircle2,
  Loader2, ArrowLeft, WifiOff, Shield, User as UserIcon,
} from 'lucide-react';
import { sendOtp, verifyOtp, loginTouristByPhone, registerAndLoginTourist, ApiError } from '../../lib/api';

type Step = 'credentials' | 'otp' | 'name' | 'verifying' | 'success' | 'error';
type FieldErrors = { fullName?: string; phone?: string; otp?: string };

interface Props {
  onClose: () => void;
  onAuthenticated: (tourist: any) => void;
  darkMode: boolean;
}

export default function LoginModal({ onClose, onAuthenticated, darkMode: dm }: Props) {
  const [step, setStep] = useState<Step>('credentials');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState<string[]>(Array(6).fill(''));
  const [errs, setErrs] = useState<FieldErrors>({});
  const [generalErr, setGenErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [resend, setResend] = useState(0);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const resendTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (resendTimer.current) clearInterval(resendTimer.current); }, []);

  const surface = dm ? '#0a1628' : '#ffffff';
  const border = dm ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  const text = dm ? '#f1f5f9' : '#0c2340';
  const subtle = dm ? 'rgba(255,255,255,0.45)' : 'rgba(12,35,64,0.45)';
  const fieldBg = dm ? 'rgba(255,255,255,0.05)' : '#f8fafc';
  const fieldBd = dm ? 'rgba(255,255,255,0.11)' : '#e2e8f0';
  const labelC = dm ? 'rgba(255,255,255,0.68)' : 'rgba(12,35,64,0.68)';

  const startResend = () => {
    setResend(30);
    resendTimer.current = setInterval(() => {
      setResend((r) => {
        if (r <= 1) { clearInterval(resendTimer.current!); resendTimer.current = null; return 0; }
        return r - 1;
      });
    }, 1000);
  };

  const validatePhone = () => {
    const e: FieldErrors = {};
    if (!phone.trim()) e.phone = 'Phone number is required';
    else if (!/^\+?[\d\s\-]{10,14}$/.test(phone)) e.phone = 'Enter a valid mobile number';
    setErrs(e);
    return !Object.keys(e).length;
  };

  // Step 1: request a real OTP for this phone number from the backend
  // (POST /auth/send-otp). No demo/local codes.
  const handleContinue = async () => {
    if (!validatePhone()) return;
    setLoading(true); setGenErr('');
    try {
      await sendOtp(phone.trim());
      setLoading(false);
      setStep('otp');
      startResend();
      setTimeout(() => otpRefs.current[0]?.focus(), 80);
    } catch (err: any) {
      setLoading(false);
      setGenErr(err instanceof ApiError ? err.message : 'Network error. Check your connection and try again.');
    }
  };

  const handleOtp = (i: number, val: string) => {
    if (!/^[0-9]?$/.test(val)) return;
    const next = [...otp]; next[i] = val; setOtp(next);
    setErrs((e) => ({ ...e, otp: undefined }));
    if (val && i < 5) otpRefs.current[i + 1]?.focus();
  };

  const handleOtpKey = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otp[i] && i > 0) otpRefs.current[i - 1]?.focus();
    if (e.key === 'ArrowLeft' && i > 0) otpRefs.current[i - 1]?.focus();
    if (e.key === 'ArrowRight' && i < 5) otpRefs.current[i + 1]?.focus();
  };

  // Step 2: verify the code against the backend (POST /auth/verify-otp),
  // then either sign the returning tourist in, or — if this phone has no
  // account yet — ask for a name to create one. Never a fake success path.
  const handleVerify = async () => {
    const code = otp.join('');
    if (code.length < 6) { setErrs({ otp: 'Enter all 6 digits' }); return; }
    setStep('verifying'); setGenErr('');
    try {
      const result = await verifyOtp(phone.trim(), code);
      if (!result.verified) {
        setStep('otp');
        setErrs({ otp: 'Invalid verification code. Please try again.' });
        return;
      }

      const existing = await loginTouristByPhone(phone.trim());
      if (existing) {
        setStep('success');
        setTimeout(() => onAuthenticated(existing.tourist), 900);
        return;
      }

      // No account registered for this phone yet — collect a name to
      // create one (backend requires full_name for a tourist profile).
      setStep('name');
    } catch (err: any) {
      setStep('otp');
      setErrs({ otp: err instanceof ApiError ? err.message : 'Could not verify the code. Please try again.' });
    }
  };

  // Step 3 (new tourists only): create the account for real via
  // POST /auth/register + /auth/login + PATCH /tourists/{id}.
  const handleRegister = async () => {
    if (!fullName.trim()) { setErrs({ fullName: 'Full name is required' }); return; }
    setStep('verifying'); setGenErr('');
    try {
      const created = await registerAndLoginTourist({ fullName: fullName.trim(), phone: phone.trim() });
      if (!created) throw new Error('Registration did not return a tourist profile.');
      setStep('success');
      setTimeout(() => onAuthenticated(created.tourist), 900);
    } catch (err: any) {
      setStep('error');
      setGenErr(err instanceof ApiError ? err.message : 'Could not create your account. Please try again.');
    }
  };

  const handleResend = () => {
    setOtp(Array(6).fill(''));
    setErrs({});
    sendOtp(phone.trim()).catch(() => { /* surfaced on next verify attempt */ });
    startResend();
    setTimeout(() => otpRefs.current[0]?.focus(), 80);
  };

  return (
    <>
      <div
        className="fixed inset-0 z-[50] animate-fade-in"
        style={{ background: 'rgba(7,15,31,0.72)', backdropFilter: 'blur(10px)' }}
        onClick={step === 'credentials' || step === 'otp' || step === 'name' ? onClose : undefined}
      />

      <div className="fixed inset-0 z-[51] flex items-end sm:items-center justify-center sm:p-5">
        <div
          className="w-full sm:max-w-[400px] rounded-t-[24px] sm:rounded-2xl overflow-hidden animate-sheet-up sm:animate-modal-in"
          style={{ background: surface, border: `1px solid ${border}`, boxShadow: `0 24px 80px rgba(0,0,0,${dm ? '0.6' : '0.25'})` }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="sm:hidden flex justify-center pt-3 pb-0">
            <div className="w-9 h-1 rounded-full" style={{ background: dm ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.1)' }} />
          </div>

          <div className="px-6 pt-5 pb-6" style={{ paddingBottom: 'max(24px,env(safe-area-inset-bottom,24px))' }}>
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: '#0c2340' }}>
                  <Shield size={16} style={{ color: '#FF9933' }} strokeWidth={2.5} />
                </div>
                <div>
                  <p className="text-[15px] font-bold leading-none" style={{ color: text, fontFamily: 'Outfit, sans-serif' }}>
                    {step === 'credentials' && 'Sign in'}
                    {step === 'otp' && 'Verify identity'}
                    {step === 'name' && 'Create your Tourist ID'}
                    {step === 'verifying' && 'Verifying...'}
                    {step === 'success' && 'Welcome'}
                    {step === 'error' && 'Something went wrong'}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: subtle }}>
                    {step === 'credentials' && 'Suraksha Setu Tourist Safety'}
                    {step === 'otp' && `Code sent to ${phone}`}
                    {step === 'name' && 'New number — tell us your name'}
                    {step === 'verifying' && 'Just a moment...'}
                    {step === 'success' && 'Taking you back to the map'}
                    {step === 'error' && 'Check your connection and try again'}
                  </p>
                </div>
              </div>
              {(step === 'credentials' || step === 'otp' || step === 'name') && (
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

            {/* ── Phone entry ── */}
            {step === 'credentials' && (
              <div className="space-y-4">
                {generalErr && (
                  <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl animate-fade-in" style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)' }}>
                    <AlertCircle size={14} style={{ color: '#ef4444', flexShrink: 0, marginTop: 1 }} />
                    <p className="text-xs leading-relaxed" style={{ color: '#ef4444' }}>{generalErr}</p>
                  </div>
                )}

                <Field
                  label="Phone number" placeholder="+91 98765 43210" value={phone}
                  onChange={setPhone} error={errs.phone} type="tel"
                  bg={fieldBg} bd={fieldBd} text={text} subtle={subtle} labelC={labelC}
                />

                <button
                  onClick={handleContinue}
                  disabled={loading}
                  className="w-full h-12 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2.5 transition-all hover:opacity-92 active:scale-[0.98] disabled:opacity-60"
                  style={{ background: '#FF9933', boxShadow: '0 4px 20px rgba(255,153,51,0.35)' }}
                >
                  {loading ? (<><Loader2 size={16} className="animate-spin" /> Sending OTP...</>) : (<>Continue <ChevronRight size={16} /></>)}
                </button>
              </div>
            )}

            {/* ── OTP ── */}
            {step === 'otp' && (
              <div className="space-y-5">
                <p className="text-sm leading-relaxed" style={{ color: subtle }}>
                  Enter the 6-digit code sent to your phone to verify your identity.
                </p>

                <div>
                  <div className="flex gap-2 justify-between">
                    {otp.map((d, i) => (
                      <input
                        key={i}
                        ref={(el) => { otpRefs.current[i] = el; }}
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
                    onClick={() => { setStep('credentials'); setOtp(Array(6).fill('')); setErrs({}); setGenErr(''); }}
                    className="flex items-center gap-1.5 text-xs transition-opacity hover:opacity-70"
                    style={{ color: subtle }}
                  >
                    <ArrowLeft size={13} /> Change number
                  </button>
                  {resend > 0
                    ? <span className="text-xs" style={{ color: subtle }}>Resend in {resend}s</span>
                    : <button onClick={handleResend} className="text-xs font-semibold text-[#FF9933] hover:underline">Resend OTP</button>}
                </div>
              </div>
            )}

            {/* ── New-tourist name capture ── */}
            {step === 'name' && (
              <div className="space-y-4">
                <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl" style={{ background: 'rgba(255,153,51,0.08)', border: '1px solid rgba(255,153,51,0.2)' }}>
                  <CheckCircle2 size={14} style={{ color: '#FF9933', flexShrink: 0, marginTop: 1 }} />
                  <p className="text-xs leading-relaxed" style={{ color: subtle }}>
                    Phone verified. This number isn't registered yet — enter your name to create your Tourist Safety ID.
                  </p>
                </div>

                <Field
                  label="Full name" placeholder="As per your ID document" value={fullName}
                  onChange={setFullName} error={errs.fullName} type="text" icon={<UserIcon size={15} />}
                  bg={fieldBg} bd={fieldBd} text={text} subtle={subtle} labelC={labelC}
                />

                <button
                  onClick={handleRegister}
                  className="w-full h-12 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2.5 transition-all hover:opacity-92 active:scale-[0.98]"
                  style={{ background: '#FF9933', boxShadow: '0 4px 20px rgba(255,153,51,0.35)' }}
                >
                  Create Tourist ID <ChevronRight size={16} />
                </button>
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
                  <p className="text-sm mt-1 max-w-[240px]" style={{ color: subtle }}>{generalErr || 'Check your network connection and try again.'}</p>
                </div>
                <button
                  onClick={() => { setStep('credentials'); setGenErr(''); }}
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
  );
}

function Field({
  label: lbl, placeholder, value, onChange, error, icon,
  bg, bd, text, subtle, labelC, type = 'text',
}: {
  label: string; placeholder: string; value: string; onChange: (v: string) => void;
  error?: string; icon?: React.ReactNode; bg: string; bd: string;
  text: string; subtle: string; labelC: string; type?: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div>
      <label className="text-xs font-medium mb-1.5 block" style={{ color: labelC }}>{lbl}</label>
      <div
        className="flex items-center gap-2.5 px-3.5 h-12 rounded-xl transition-all duration-150"
        style={{ background: bg, border: `1.5px solid ${error ? '#dc2626' : focused ? '#FF9933' : bd}`, boxShadow: focused ? '0 0 0 3px rgba(255,153,51,0.12)' : 'none' }}
      >
        {icon && <span style={{ color: focused ? '#FF9933' : subtle, transition: 'color 0.15s', flexShrink: 0 }}>{icon}</span>}
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
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
  );
}
