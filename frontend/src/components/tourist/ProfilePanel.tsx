import { useEffect, useState } from 'react';
import {
  User, Bell, Shield, ChevronRight,
  Moon, LogOut, Phone, Hash, Globe, HelpCircle,
  Lock, Wifi, Loader2, Pencil, Check, X as XIcon, Landmark,
} from 'lucide-react';
import { getDigitalId, updateTouristProfile, ApiError } from '../../lib/api';
import { TouristUser, Language } from '../../types';

interface Props {
  darkMode: boolean;
  toggleDark: () => void;
  isAuthenticated: boolean;
  user: TouristUser | null;
  onLogin: () => void;
  onLogout: () => void;
  onOpenAuthorityAccess: () => void;
  language: Language;
  onLanguageChange: (lang: Language) => void;
}

export default function ProfilePanel({
  darkMode: dm,
  toggleDark,
  isAuthenticated,
  user,
  onLogin,
  onLogout,
  onOpenAuthorityAccess,
  language,
  onLanguageChange
}: Props) {
  const [notifs, setNotifs] = useState(true);
  const [locShare, setLocShare] = useState(false);
  const [digitalId, setDigitalId] = useState<string | null>(user?.tourist_id || null);
  const [editingContact, setEditingContact] = useState(false);
  const [contactDraft, setContactDraft] = useState(user?.emergency_contacts?.[0]?.phone || '');
  const [savingContact, setSavingContact] = useState(false);
  const [contactErr, setContactErr] = useState('');

  useEffect(() => {
    setContactDraft(user?.emergency_contacts?.[0]?.phone || '');
    setDigitalId(user?.tourist_id || null);
  }, [user?.id]);

  // Fetch the public digital safety pass code (TOUR-YYYY-HEX) if the profile
  // we were handed doesn't already include it (e.g. KYC just got verified) —
  // real backend call, not a generated placeholder.
  useEffect(() => {
    if (isAuthenticated && user?.id && !digitalId) {
      getDigitalId(user.id).then((r) => setDigitalId(r.tourist_id || null)).catch(() => {});
    }
  }, [isAuthenticated, user?.id, digitalId]);

  const saveContact = async () => {
    if (!user?.id) return;
    setSavingContact(true); setContactErr('');
    try {
      await updateTouristProfile(user.id, {
        emergency_contacts: [{ name: null, relation: null, phone: contactDraft.trim() }],
      });
      setEditingContact(false);
    } catch (err: any) {
      setContactErr(err instanceof ApiError ? err.message : 'Could not save. Try again.');
    } finally {
      setSavingContact(false);
    }
  };

  const surface = dm ? '#091222' : '#f4f6f9';
  const card = dm ? '#0c1d33' : '#ffffff';
  const border = dm ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
  const text = dm ? '#f1f5f9' : '#0c2340';
  const subtle = dm ? 'rgba(255,255,255,0.44)' : 'rgba(12,35,64,0.44)';
  const shadow = dm ? '0 1px 8px rgba(0,0,0,0.35)' : '0 1px 8px rgba(0,0,0,0.06)';

  const displayName = user?.full_name?.trim() || 'Traveller';
  const initial = displayName.charAt(0).toUpperCase() || 'T';

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: surface, fontFamily: 'Inter, sans-serif' }}>
      <div className="px-5 pt-6 pb-5" style={{ borderBottom: `1px solid ${dm ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}` }}>
        {isAuthenticated && user ? (
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold text-white flex-shrink-0" style={{ background: 'linear-gradient(135deg, #FF9933, #e67a0f)', boxShadow: '0 4px 16px rgba(255,153,51,0.35)' }}>
              {initial}
            </div>
            <div className="min-w-0">
              <p className="text-lg font-bold truncate" style={{ color: text, fontFamily: 'Outfit, sans-serif' }}>{displayName}</p>
              <div className="flex items-center gap-2 mt-1">
                <Hash size={12} style={{ color: subtle }} />
                <span className="text-xs font-mono truncate" style={{ color: subtle }}>{digitalId || user.id}</span>
              </div>
              {user.phone_number && (
                <div className="flex items-center gap-2 mt-1">
                  <Phone size={12} style={{ color: subtle }} />
                  <span className="text-xs" style={{ color: subtle }}>{user.phone_number}</span>
                </div>
              )}
              <div className="flex items-center gap-1.5 mt-1.5">
                <div className="w-2 h-2 rounded-full" style={{ background: user.kyc_status === 'VERIFIED' ? '#138808' : '#d97706' }} />
                <span className="text-xs font-medium" style={{ color: user.kyc_status === 'VERIFIED' ? '#138808' : '#d97706' }}>
                  {user.kyc_status === 'VERIFIED' ? 'Verified tourist' : 'ID verification pending'}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center py-4 gap-4">
            <div className="w-18 h-18 rounded-2xl flex items-center justify-center" style={{ background: dm ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)', width: 72, height: 72 }}>
              <User size={32} style={{ color: subtle }} />
            </div>
            <div className="text-center">
              <p className="text-base font-semibold" style={{ color: text }}>Not signed in</p>
              <p className="text-sm mt-1" style={{ color: subtle }}>Sign in with your phone number to access all features</p>
            </div>
            <button
              onClick={onLogin}
              className="h-11 px-8 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 active:scale-95"
              style={{ background: '#FF9933', boxShadow: '0 3px 16px rgba(255,153,51,0.35)' }}
            >
              Sign in
            </button>
          </div>
        )}
      </div>

      <div className="px-4 py-5 space-y-5">
        {isAuthenticated && (
          <section>
            <SectionLabel text={text} label="Emergency contact" />
            <div className="rounded-xl p-4" style={{ background: card, border: `1px solid ${border}`, boxShadow: shadow }}>
              {!editingContact ? (
                <div className="flex items-center gap-3">
                  <Phone size={16} style={{ color: '#dc2626' }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm" style={{ color: user?.emergency_contacts?.[0]?.phone ? text : subtle }}>
                      {user?.emergency_contacts?.[0]?.phone || 'No emergency contact on file'}
                    </p>
                  </div>
                  <button onClick={() => setEditingContact(true)} aria-label="Edit emergency contact" style={{ color: subtle }}>
                    <Pencil size={14} />
                  </button>
                </div>
              ) : (
                <div className="space-y-2.5">
                  <input
                    value={contactDraft}
                    onChange={(e) => setContactDraft(e.target.value)}
                    placeholder="Name and phone number"
                    className="w-full h-10 px-3 rounded-lg text-sm outline-none"
                    style={{ background: dm ? 'rgba(255,255,255,0.05)' : '#f8fafc', border: `1.5px solid ${dm ? 'rgba(255,255,255,0.11)' : '#e2e8f0'}`, color: text }}
                  />
                  {contactErr && <p className="text-xs" style={{ color: '#ef4444' }}>{contactErr}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={saveContact}
                      disabled={savingContact}
                      className="flex-1 h-9 rounded-lg text-xs font-bold text-white flex items-center justify-center gap-1.5"
                      style={{ background: '#FF9933' }}
                    >
                      {savingContact ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save
                    </button>
                    <button
                      onClick={() => { setEditingContact(false); setContactDraft(user?.emergency_contacts?.[0]?.phone || ''); setContactErr(''); }}
                      className="h-9 px-3 rounded-lg text-xs font-medium"
                      style={{ background: dm ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)', color: text }}
                    >
                      <XIcon size={13} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        <section>
          <SectionLabel text={text} label="Settings" />
          <div className="rounded-xl overflow-hidden" style={{ background: card, border: `1px solid ${border}`, boxShadow: shadow }}>
            <ToggleRow icon={<Moon size={16} />} label="Dark mode" value={dm} onChange={toggleDark} text={text} subtle={subtle} border={border} />
            <ToggleRow icon={<Bell size={16} />} label="Safety notifications" value={notifs} onChange={() => setNotifs((v) => !v)} text={text} subtle={subtle} border={border} />
            <ToggleRow icon={<Wifi size={16} />} label="Share location with contacts" value={locShare} onChange={() => setLocShare((v) => !v)} text={text} subtle={subtle} border={border} />
            
            {/* Language Selection Row */}
            <div className="flex items-center gap-3 px-4 py-3" style={{ borderTop: `1px solid ${border}` }}>
              <span style={{ color: subtle }}><Globe size={16} /></span>
              <span className="flex-1 text-sm" style={{ color: text }}>Language / भाषा</span>
              <div className="flex items-center bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 rounded-lg p-0.5 gap-0.5">
                <button
                  onClick={() => onLanguageChange('en')}
                  className={`px-2.5 py-1 text-[11px] font-extrabold rounded-md transition-all cursor-pointer ${
                    language === 'en'
                      ? dm ? 'bg-slate-750 text-white shadow-sm' : 'bg-white text-slate-800 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  EN
                </button>
                <button
                  onClick={() => onLanguageChange('hi')}
                  className={`px-2.5 py-1 text-[11px] font-extrabold rounded-md transition-all cursor-pointer ${
                    language === 'hi'
                      ? dm ? 'bg-slate-750 text-white shadow-sm' : 'bg-white text-slate-800 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  हिंदी
                </button>
              </div>
            </div>
          </div>
        </section>

        <section>
          <SectionLabel text={text} label="Safety & support" />
          <div className="rounded-xl overflow-hidden" style={{ background: card, border: `1px solid ${border}`, boxShadow: shadow }}>
            <LinkRow icon={<Phone size={16} />} label="Emergency helpline" sub="1363 — Tourism police" text={text} subtle={subtle} border={border} color="#dc2626" href="tel:1363" />
            <LinkRow icon={<Shield size={16} />} label="Safety guidelines" sub="Travel smart in India" text={text} subtle={subtle} border={border} />
            <LinkRow icon={<Globe size={16} />} label="Tourism authority" sub="Ministry of Tourism, India" text={text} subtle={subtle} border={border} />
            <LinkRow icon={<HelpCircle size={16} />} label="Help & FAQ" sub="App support and guide" text={text} subtle={subtle} border={border} last />
          </div>
        </section>

        <section>
          <SectionLabel text={text} label="Command centre" />
          <div className="rounded-xl overflow-hidden" style={{ background: card, border: `1px solid ${border}`, boxShadow: shadow }}>
            <LinkRow icon={<Landmark size={16} />} label="Authority / officer sign-in" sub="Tourism police & command centre access" text={text} subtle={subtle} border={border} last onClick={onOpenAuthorityAccess} />
          </div>
        </section>

        {isAuthenticated && (
          <section>
            <SectionLabel text={text} label="Account" />
            <div className="rounded-xl overflow-hidden" style={{ background: card, border: `1px solid ${border}`, boxShadow: shadow }}>
              <LinkRow icon={<Lock size={16} />} label="Privacy & data" sub="How we use your data" text={text} subtle={subtle} border={border} />
              <button
                onClick={onLogout}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left text-sm transition-colors"
                style={{ color: '#ef4444', borderTop: `1px solid ${border}` }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(220,38,38,0.06)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <LogOut size={16} />
                <span className="font-medium">Sign out</span>
              </button>
            </div>
          </section>
        )}

        <p className="text-center text-xs pb-4" style={{ color: dm ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.2)' }}>
          Suraksha Setu v2.0 · India Tourism Authority
        </p>
      </div>
    </div>
  );
}

function SectionLabel({ label, text }: { label: string; text: string }) {
  return (
    <p className="text-xs font-bold uppercase tracking-widest mb-2 px-1" style={{ color: text, letterSpacing: '0.07em', fontFamily: 'Inter, sans-serif', opacity: 0.55 }}>
      {label}
    </p>
  );
}

function ToggleRow({ icon, label, value, onChange, text, subtle, border, last }: {
  icon: React.ReactNode; label: string; value: boolean; onChange: () => void;
  text: string; subtle: string; border: string; last?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5" style={{ borderBottom: last ? 'none' : `1px solid ${border}` }}>
      <span style={{ color: subtle }}>{icon}</span>
      <span className="flex-1 text-sm" style={{ color: text }}>{label}</span>
      <button onClick={onChange} className="relative w-11 h-6 rounded-full transition-all duration-200 flex-shrink-0" style={{ background: value ? '#FF9933' : subtle + '40' }} role="switch" aria-checked={value}>
        <span className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200" style={{ transform: value ? 'translateX(20px)' : 'translateX(0)' }} />
      </button>
    </div>
  );
}

function LinkRow({ icon, label, sub, text, subtle, border, color, last, href, onClick }: {
  icon: React.ReactNode; label: string; sub: string;
  text: string; subtle: string; border: string; color?: string; last?: boolean; href?: string; onClick?: () => void;
}) {
  const content = (
    <>
      <span style={{ color: color || subtle }}>{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium" style={{ color: color || text }}>{label}</p>
        <p className="text-xs mt-0.5" style={{ color: subtle }}>{sub}</p>
      </div>
      <ChevronRight size={14} style={{ color: subtle }} />
    </>
  );
  const className = "w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors";
  const style = { borderBottom: last ? 'none' : `1px solid ${border}` } as const;
  const hover = (e: React.MouseEvent<HTMLElement>) => (e.currentTarget.style.background = 'rgba(128,128,128,0.05)');
  const unhover = (e: React.MouseEvent<HTMLElement>) => (e.currentTarget.style.background = 'transparent');

  if (href) {
    return <a href={href} className={className} style={style} onMouseEnter={hover} onMouseLeave={unhover}>{content}</a>;
  }
  return <button onClick={onClick} className={className} style={style} onMouseEnter={hover} onMouseLeave={unhover}>{content}</button>;
}
