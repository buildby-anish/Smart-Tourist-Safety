import { useState, useRef, KeyboardEvent, useEffect } from 'react';
import {
  X, ChevronRight, AlertCircle, CheckCircle2,
  Loader2, ArrowLeft, WifiOff, Shield, User as UserIcon, Lock, Phone,
} from 'lucide-react';
import {
  sendOtp,
  verifyOtp,
  loginTouristByPhone,
  registerAndLoginTourist,
  authenticateAuthority,
  updateTouristProfile,
  getApiBaseUrl,
  ApiError
} from '../../lib/api';
import { IdentityVerification } from '../verification/IdentityVerification';
import { DigiLockerVerify } from '../verification/DigiLockerVerify';
import type { DocumentConfirmResponse } from '../../lib/verificationApi';
import type { DigiLockerConfirmResult } from '../../lib/api';

type Step =
  | 'role_selection'
  | 'tourist_credentials'
  | 'otp'
  | 'name'
  | 'kyc'
  | 'authority_credentials'
  | 'verifying'
  | 'success'
  | 'error';

type FieldErrors = { fullName?: string; phone?: string; otp?: string; badgeId?: string; authCode?: string };

interface Props {
  onClose: () => void;
  onAuthenticated: (role: 'tourist' | 'authority', user: any) => void;
  darkMode: boolean;
  initialMode?: 'login' | 'signup';
  /** When false, hides the close (X) button and disables backdrop-click-to-
   * close — used for the mandatory sign-in gate so it can't be dismissed
   * without completing authentication. Defaults to true (existing,
   * dismissable behavior) everywhere else the modal is used. */
  dismissable?: boolean;
}

export default function LoginModal({ onClose, onAuthenticated, darkMode: dm, initialMode = 'login', dismissable = true }: Props) {
  const [step, setStep] = useState<Step>(
    initialMode === 'signup' ? 'tourist_credentials' : 'role_selection'
  );
  const [mode, setMode] = useState<'login' | 'signup'>(initialMode);
  
  // Tourist details
  const [identifier, setIdentifier] = useState('');
  const [fullName, setFullName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otp, setOtp] = useState<string[]>(Array(6).fill(''));

  // Set once registration succeeds, so the 'kyc' step (which runs after
  // the account already exists) knows which profile to attach the
  // verification to and can complete sign-in once KYC is done/skipped.
  const [createdTourist, setCreatedTourist] = useState<{ tourist: any; token: string } | null>(null);
  const [kycMethod, setKycMethod] = useState<'ocr' | 'digilocker'>('digilocker');
  
  // Authority details
  const [badgeId, setBadgeId] = useState('');
  const [authCode, setAuthCode] = useState('');

  const [errs, setErrs] = useState<FieldErrors>({});
  const [generalErr, setGenErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [resend, setResend] = useState(0);
  
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const resendTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (resendTimer.current) clearInterval(resendTimer.current); }, []);

  const surface = dm ? '#18181b' : '#ffffff';
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

  const validateIdentifier = () => {
    const e: FieldErrors = {};
    const val = identifier.trim();
    if (!val) {
      e.phone = 'Email or phone number is required';
    } else if (val.includes('@')) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
        e.phone = 'Enter a valid email address';
      }
    } else {
      if (!/^\+?[\d\s\-]{10,14}$/.test(val)) {
        e.phone = 'Enter a valid mobile number';
      }
    }
    setErrs(e);
    return !Object.keys(e).length;
  };

  const handleTouristContinue = async () => {
    if (!validateIdentifier()) return;
    setLoading(true); setGenErr('');
    const val = identifier.trim();
    const isEmail = val.includes('@');

    if (isEmail) {
      try {
        if (mode === 'login') {
          // Email Login: try to sign in directly with derived credentials
          const existing = await loginTouristByPhone(val);
          setLoading(false);
          if (existing) {
            setStep('success');
            setTimeout(() => onAuthenticated('tourist', existing.tourist), 900);
          } else {
            setGenErr('No account matches this email. Check the spelling or switch to Sign Up below.');
          }
        } else {
          // Email Sign Up: check if account already exists
          const existing = await loginTouristByPhone(val);
          setLoading(false);
          if (existing) {
            setGenErr('This email is already registered. Please Sign In instead.');
          } else {
            // New email registration: collect full name
            setStep('name');
          }
        }
      } catch (err: any) {
        setLoading(false);
        setGenErr(err instanceof ApiError ? err.message : 'Authentication failed. Please try again.');
      }
    } else {
      // Phone OTP flow
      try {
        await sendOtp(val);
        setLoading(false);
        setStep('otp');
        startResend();
        setTimeout(() => otpRefs.current[0]?.focus(), 80);
      } catch (err: any) {
        setLoading(false);
        setGenErr(err instanceof ApiError ? err.message : 'Failed to send OTP. Please try again.');
      }
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

  const handleVerify = async () => {
    const code = otp.join('');
    if (code.length < 6) { setErrs({ otp: 'Enter all 6 digits' }); return; }
    setStep('verifying'); setGenErr('');
    try {
      const result = await verifyOtp(identifier.trim(), code);
      if (!result.verified) {
        setStep('otp');
        setErrs({ otp: 'Invalid verification code. Please try again.' });
        return;
      }

      const existing = await loginTouristByPhone(identifier.trim());
      if (existing) {
        setStep('success');
        setTimeout(() => onAuthenticated('tourist', existing.tourist), 900);
        return;
      }

      // No profile found: proceed to name entry
      setStep('name');
    } catch (err: any) {
      setStep('otp');
      setErrs({ otp: err instanceof ApiError ? err.message : 'Verification failed. Please try again.' });
    }
  };

  const handleRegister = async () => {
    const val = identifier.trim();
    const isEmail = val.includes('@');
    const e: FieldErrors = {};
    if (!fullName.trim()) e.fullName = 'Full name is required';
    // Phone is only asked here for the email signup path — the phone-OTP
    // path already collected and verified it as `identifier` earlier.
    if (isEmail && !/^\+?[\d\s\-]{10,14}$/.test(phoneNumber.trim())) {
      e.phone = 'Enter a valid mobile number';
    }
    if (Object.keys(e).length) { setErrs(e); return; }

    setStep('verifying'); setGenErr('');
    try {
      const created = await registerAndLoginTourist({
        fullName: fullName.trim(),
        phone: isEmail ? phoneNumber.trim() : val,
        email: isEmail ? val : undefined,
      });
      if (!created) throw new Error('Registration did not return a tourist profile.');
      setCreatedTourist(created);
      setStep('kyc');
    } catch (err: any) {
      setStep('error');
      setGenErr(err instanceof ApiError ? err.message : 'Could not create your account. Please try again.');
    }
  };

  const finishSignup = (tourist: any) => {
    setStep('success');
    setTimeout(() => onAuthenticated('tourist', tourist), 900);
  };

  const handleKycComplete = async (result: DocumentConfirmResponse) => {
    if (!createdTourist) return;
    if (result.status !== 'VERIFIED') {
      // IdentityVerification's own COMPLETED/REJECTED view already offers
      // a retry; stay on this step rather than forcing them out.
      return;
    }
    try {
      const updated = await updateTouristProfile(createdTourist.tourist.id, {
        kyc_status: 'VERIFIED',
      });
      finishSignup(updated);
    } catch {
      // KYC itself succeeded even if this follow-up PATCH didn't — don't
      // strand a successfully-registered, successfully-verified user on
      // an error screen over it.
      finishSignup(createdTourist.tourist);
    }
  };

  const handleDigiLockerComplete = (result: DigiLockerConfirmResult) => {
    if (!createdTourist) return;
    if (result.kyc_status !== 'VERIFIED') return;
    // DigiLocker's /confirm endpoint already persisted kyc_status server-side
    // (via the same update_tourist path the OCR flow uses) — no follow-up
    // PATCH needed here, just reflect the confirmed state locally.
    finishSignup({ ...createdTourist.tourist, kyc_status: 'VERIFIED', blockchain_tx_hash: result.blockchain_tx_hash });
  };

  const handleResend = () => {
    setOtp(Array(6).fill(''));
    setErrs({});
    sendOtp(identifier.trim()).catch(() => {});
    startResend();
    setTimeout(() => otpRefs.current[0]?.focus(), 80);
  };

  const handleAuthorityLogin = async () => {
    if (!badgeId.trim()) { setErrs({ badgeId: 'Badge ID is required' }); return; }
    if (!authCode.trim()) { setErrs({ authCode: 'Auth Code is required' }); return; }
    setLoading(true); setGenErr('');
    try {
      const success = await authenticateAuthority(badgeId.trim(), authCode.trim());
      setLoading(false);
      if (success) {
        setStep('success');
        setTimeout(() => onAuthenticated('authority', success), 900);
      } else {
        setGenErr('Invalid Official Badge ID or Auth Code.');
      }
    } catch (err: any) {
      setLoading(false);
      setGenErr(err instanceof ApiError ? err.message : 'Official login failed.');
    }
  };

  return (
    <>
      {/* Modal backdrop */}
      <div
        className="fixed inset-0 z-[50] animate-fade-in"
        style={{ background: 'rgba(7,15,31,0.72)', backdropFilter: 'blur(10px)' }}
        onClick={dismissable ? onClose : undefined}
      />

      {/* Centered Modal container */}
      <div className="fixed inset-0 z-[51] flex items-center justify-center p-4">
        <div
          className={`w-full rounded-2xl overflow-hidden animate-modal-in ${step === 'kyc' ? 'max-w-[640px]' : 'max-w-[400px]'}`}
          style={{
            background: surface,
            border: `1px solid ${border}`,
            boxShadow: `0 24px 80px rgba(0,0,0,${dm ? '0.6' : '0.25'})`,
            maxHeight: step === 'kyc' ? '90vh' : undefined,
            overflowY: step === 'kyc' ? 'auto' : undefined,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-6 py-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: '#0c2340' }}>
                  <Shield size={16} style={{ color: '#FF9933' }} strokeWidth={2.5} />
                </div>
                <div>
                  <p className="text-[15px] font-bold leading-none" style={{ color: text, fontFamily: 'Outfit, sans-serif' }}>
                    {step === 'role_selection' && 'Suraksha Setu'}
                    {step === 'tourist_credentials' && (mode === 'login' ? 'Tourist Sign In' : 'Tourist Sign Up')}
                    {step === 'otp' && 'Verify Identity'}
                    {step === 'name' && 'Complete Profile'}
                    {step === 'kyc' && 'Identity Verification'}
                    {step === 'authority_credentials' && 'Official Sign In'}
                    {step === 'verifying' && 'Verifying...'}
                    {step === 'success' && 'Welcome'}
                    {step === 'error' && 'Something went wrong'}
                  </p>
                  <p className="text-xs mt-1" style={{ color: subtle }}>
                    {step === 'role_selection' && 'Choose account type to continue'}
                    {step === 'tourist_credentials' && 'Access safety & tracking services'}
                    {step === 'otp' && `Enter code sent to ${identifier}`}
                    {step === 'name' && 'Tell us your details to generate your ID'}
                    {step === 'kyc' && 'Scan a government ID to verify your Tourist Safety ID'}
                    {step === 'authority_credentials' && 'Official access portal'}
                    {step === 'verifying' && 'Just a moment...'}
                    {step === 'success' && 'Redirecting...'}
                    {step === 'error' && 'Check your inputs and try again'}
                  </p>
                </div>
              </div>
              {dismissable && (
                <button
                  onClick={onClose}
                  className="w-8 h-8 rounded-full flex items-center justify-center transition-all hover:opacity-75"
                  style={{ background: dm ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}
                  aria-label="Close"
                >
                  <X size={15} style={{ color: subtle }} />
                </button>
              )}
            </div>

            {/* ── step 1: Role Selection ── */}
            {step === 'role_selection' && (
              <div className="space-y-4">
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: labelC }}>
                  Continue as
                </p>

                <div className="space-y-3">
                  <button
                    onClick={() => {
                      setStep('tourist_credentials');
                      setMode('login');
                      setErrs({});
                      setGenErr('');
                    }}
                    className="w-full text-left p-4 rounded-xl border transition-all hover:scale-[1.01] active:scale-[0.99] flex items-start gap-3.5"
                    style={{
                      background: fieldBg,
                      borderColor: dm ? 'rgba(255,255,255,0.1)' : 'rgba(12,35,64,0.1)',
                    }}
                  >
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center text-xl flex-shrink-0" style={{ background: dm ? 'rgba(255,255,255,0.06)' : 'rgba(12,35,64,0.05)' }}>
                      🧳
                    </div>
                    <div>
                      <p className="font-bold text-sm" style={{ color: text }}>Tourist</p>
                      <p className="text-xs mt-0.5" style={{ color: subtle }}>Sign in / create account</p>
                    </div>
                  </button>

                  <button
                    onClick={() => {
                      setStep('authority_credentials');
                      setMode('login');
                      setErrs({});
                      setGenErr('');
                    }}
                    className="w-full text-left p-4 rounded-xl border transition-all hover:scale-[1.01] active:scale-[0.99] flex items-start gap-3.5"
                    style={{
                      background: fieldBg,
                      borderColor: dm ? 'rgba(255,255,255,0.1)' : 'rgba(12,35,64,0.1)',
                    }}
                  >
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center text-xl flex-shrink-0" style={{ background: dm ? 'rgba(255,255,255,0.06)' : 'rgba(12,35,64,0.05)' }}>
                      🛡️
                    </div>
                    <div>
                      <p className="font-bold text-sm" style={{ color: text }}>Authority</p>
                      <p className="text-xs mt-0.5" style={{ color: subtle }}>Official login only</p>
                    </div>
                  </button>
                </div>
              </div>
            )}

            {/* ── step 2: Tourist Credentials ── */}
            {step === 'tourist_credentials' && (
              <div className="space-y-4">
                {generalErr && (
                  <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl animate-fade-in" style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)' }}>
                    <AlertCircle size={14} style={{ color: '#ef4444', flexShrink: 0, marginTop: 1 }} />
                    <p className="text-xs leading-relaxed" style={{ color: '#ef4444' }}>{generalErr}</p>
                  </div>
                )}

                <Field
                  label="Email or Phone number"
                  placeholder="Enter email or mobile number"
                  value={identifier}
                  onChange={setIdentifier}
                  error={errs.phone}
                  bg={fieldBg}
                  bd={fieldBd}
                  text={text}
                  subtle={subtle}
                  labelC={labelC}
                />

                <button
                  onClick={handleTouristContinue}
                  disabled={loading}
                  className="w-full h-12 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2.5 transition-all hover:opacity-92 active:scale-[0.98] disabled:opacity-60"
                  style={{ background: '#FF9933', boxShadow: '0 4px 20px rgba(255,153,51,0.35)' }}
                >
                  {loading ? (
                    <><Loader2 size={16} className="animate-spin" /> Continuing...</>
                  ) : (
                    <>Continue <ChevronRight size={16} /></>
                  )}
                </button>

                <div className="flex items-center justify-between pt-2">
                  <button
                    onClick={() => {
                      setStep('role_selection');
                      setErrs({});
                      setGenErr('');
                    }}
                    className="flex items-center gap-1.5 text-xs transition-opacity hover:opacity-70"
                    style={{ color: subtle }}
                  >
                    <ArrowLeft size={13} /> Back
                  </button>
                  {mode === 'login' ? (
                    <p className="text-xs" style={{ color: subtle }}>
                      Don't have an account?{' '}
                      <button
                        onClick={() => { setMode('signup'); setErrs({}); setGenErr(''); }}
                        className="font-bold text-[#FF9933] hover:underline"
                      >
                        Sign Up
                      </button>
                    </p>
                  ) : (
                    <p className="text-xs" style={{ color: subtle }}>
                      Already have an account?{' '}
                      <button
                        onClick={() => { setMode('login'); setErrs({}); setGenErr(''); }}
                        className="font-bold text-[#FF9933] hover:underline"
                      >
                        Sign In
                      </button>
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* ── step 3: Phone OTP ── */}
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
                        className="otp-box animate-modal-in"
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
                    onClick={() => { setStep('tourist_credentials'); setOtp(Array(6).fill('')); setErrs({}); setGenErr(''); }}
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

            {/* ── step 4: Name Capture ── */}
            {step === 'name' && (
              <div className="space-y-4">
                <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl" style={{ background: 'rgba(255,153,51,0.08)', border: '1px solid rgba(255,153,51,0.2)' }}>
                  <CheckCircle2 size={14} style={{ color: '#FF9933', flexShrink: 0, marginTop: 1 }} />
                  <p className="text-xs leading-relaxed" style={{ color: subtle }}>
                    Identifier verified! Enter your details to generate your official Tourist Safety ID.
                  </p>
                </div>

                <Field
                  label="Full Name"
                  placeholder="As per your identity document"
                  value={fullName}
                  onChange={setFullName}
                  error={errs.fullName}
                  icon={<UserIcon size={15} />}
                  bg={fieldBg}
                  bd={fieldBd}
                  text={text}
                  subtle={subtle}
                  labelC={labelC}
                />

                {/* Phone is only asked here for email signups — the phone
                    OTP path already collected and verified it as the
                    identifier before this step. */}
                {identifier.trim().includes('@') && (
                  <Field
                    label="Phone Number"
                    placeholder="10-digit mobile number"
                    value={phoneNumber}
                    onChange={setPhoneNumber}
                    error={errs.phone}
                    icon={<Phone size={15} />}
                    bg={fieldBg}
                    bd={fieldBd}
                    text={text}
                    subtle={subtle}
                    labelC={labelC}
                  />
                )}

                <button
                  onClick={handleRegister}
                  className="w-full h-12 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2.5 transition-all hover:opacity-92 active:scale-[0.98]"
                  style={{ background: '#FF9933', boxShadow: '0 4px 20px rgba(255,153,51,0.35)' }}
                >
                  Continue <ChevronRight size={16} />
                </button>

                <button
                  onClick={() => { setStep('tourist_credentials'); setErrs({}); setGenErr(''); }}
                  className="flex items-center gap-1.5 text-xs transition-opacity hover:opacity-70"
                  style={{ color: subtle }}
                >
                  <ArrowLeft size={13} /> Back
                </button>
              </div>
            )}

            {/* ── step: KYC / Identity Verification ── */}
            {step === 'kyc' && createdTourist && (
              <div className="space-y-3">
                <div className="flex rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 text-xs font-medium">
                  <button
                    onClick={() => setKycMethod('digilocker')}
                    className={`flex-1 py-2 transition-colors ${kycMethod === 'digilocker' ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                  >
                    DigiLocker (Instant)
                  </button>
                  <button
                    onClick={() => setKycMethod('ocr')}
                    className={`flex-1 py-2 transition-colors ${kycMethod === 'ocr' ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                  >
                    Scan ID Document
                  </button>
                </div>

                {kycMethod === 'digilocker' ? (
                  <DigiLockerVerify
                    touristId={createdTourist.tourist.id}
                    onVerificationComplete={handleDigiLockerComplete}
                  />
                ) : (
                  <IdentityVerification
                    touristId={createdTourist.tourist.id}
                    apiUrl={`${getApiBaseUrl()}/verifications`}
                    onVerificationComplete={handleKycComplete}
                  />
                )}

                <button
                  onClick={() => finishSignup(createdTourist.tourist)}
                  className="w-full text-center text-xs transition-opacity hover:opacity-70"
                  style={{ color: subtle }}
                >
                  Remind me later — some features (like trip planning) stay locked until verified
                </button>
              </div>
            )}

            {/* ── step 5: Authority Credentials ── */}
            {step === 'authority_credentials' && (
              <div className="space-y-4">
                {generalErr && (
                  <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl animate-fade-in" style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)' }}>
                    <AlertCircle size={14} style={{ color: '#ef4444', flexShrink: 0, marginTop: 1 }} />
                    <p className="text-xs leading-relaxed" style={{ color: '#ef4444' }}>{generalErr}</p>
                  </div>
                )}

                <Field
                  label="Badge ID"
                  placeholder="Official ID / Username"
                  value={badgeId}
                  onChange={setBadgeId}
                  error={errs.badgeId}
                  icon={<UserIcon size={15} />}
                  bg={fieldBg}
                  bd={fieldBd}
                  text={text}
                  subtle={subtle}
                  labelC={labelC}
                />

                <Field
                  label="Auth Code"
                  placeholder="MFA OTP or Code"
                  value={authCode}
                  onChange={setAuthCode}
                  error={errs.authCode}
                  icon={<Lock size={15} />}
                  type="password"
                  bg={fieldBg}
                  bd={fieldBd}
                  text={text}
                  subtle={subtle}
                  labelC={labelC}
                />

                <button
                  onClick={handleAuthorityLogin}
                  disabled={loading}
                  className="w-full h-12 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2.5 transition-all hover:opacity-92 active:scale-[0.98] disabled:opacity-60"
                  style={{ background: '#0C2340', border: '1px solid rgba(255,255,255,0.1)' }}
                >
                  {loading ? (
                    <><Loader2 size={16} className="animate-spin" /> Verifying...</>
                  ) : (
                    <>Sign In</>
                  )}
                </button>

                <button
                  onClick={() => {
                    setStep('role_selection');
                    setErrs({});
                    setGenErr('');
                  }}
                  className="flex items-center gap-1.5 text-xs transition-opacity hover:opacity-70"
                  style={{ color: subtle }}
                >
                  <ArrowLeft size={13} /> Back
                </button>
              </div>
            )}

            {/* ── step 6: Verifying ── */}
            {step === 'verifying' && (
              <div className="flex flex-col items-center py-8 gap-4 animate-fade-in text-center">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(255,153,51,0.1)' }}>
                  <Loader2 size={30} style={{ color: '#FF9933' }} className="animate-spin" />
                </div>
                <div>
                  <p className="font-semibold text-[15px]" style={{ color: text }}>Verifying Identity</p>
                  <p className="text-xs mt-1" style={{ color: subtle }}>Accessing secure database...</p>
                </div>
              </div>
            )}

            {/* ── step 7: Success ── */}
            {step === 'success' && (
              <div className="flex flex-col items-center py-8 gap-4 animate-fade-in text-center">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(19,136,8,0.1)' }}>
                  <CheckCircle2 size={30} style={{ color: '#138808' }} />
                </div>
                <div>
                  <p className="font-semibold text-[15px]" style={{ color: text }}>Identity Verified</p>
                  <p className="text-xs mt-1" style={{ color: subtle }}>Opening portal...</p>
                </div>
              </div>
            )}

            {/* ── step 8: Error ── */}
            {step === 'error' && (
              <div className="flex flex-col items-center py-8 gap-4 animate-fade-in text-center">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(220,38,38,0.08)' }}>
                  <WifiOff size={30} style={{ color: '#dc2626' }} />
                </div>
                <div>
                  <p className="font-semibold text-[15px]" style={{ color: text }}>Connection Issue</p>
                  <p className="text-xs mt-1 max-w-[240px]" style={{ color: subtle }}>{generalErr || 'Please check your connection and try again.'}</p>
                </div>
                <button
                  onClick={() => { setStep('role_selection'); setGenErr(''); setErrs({}); }}
                  className="mt-2 h-11 px-6 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-92 active:scale-95"
                  style={{ background: '#FF9933' }}
                >
                  Try Again
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
          className="flex-1 bg-transparent text-base outline-none"
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
