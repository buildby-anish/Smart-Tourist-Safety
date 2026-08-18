import { useState } from 'react'
import {
  User, MapPin, Bell, Shield, ChevronRight,
  Moon, LogOut, Phone, Hash, Globe, HelpCircle,
  Star, Bookmark, Lock, Wifi, Edit3, Check, X as CloseIcon,
} from 'lucide-react'
import { api } from '../lib/api'

interface AuthUser {
  id: string;
  fullName?: string;
  phone?: string;
  email?: string;
  preferredLanguage?: string;
  emergencyContact?: string;
  kycVerified?: boolean;
}

interface Props {
  darkMode: boolean
  toggleDark: () => void
  isAuthenticated: boolean
  user: AuthUser | null
  onLogin: () => void
  onLogout: () => void
  onProfileUpdate: (updatedUser: Partial<AuthUser>) => void
}

const SAVED = [
  { name: 'Gateway of India',    sub: 'Tourist Attraction · 0.8 km', img: 'https://images.unsplash.com/photo-1529253355930-ddbe423a2ac7?w=96&h=64&fit=crop&q=75' },
  { name: 'Taj Mahal Palace',    sub: 'Luxury Hotel · 1.2 km',       img: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=96&h=64&fit=crop&q=75' },
  { name: 'Marine Drive',        sub: 'Promenade · 3.6 km',          img: 'https://images.unsplash.com/photo-1567157577867-05ccb1388e66?w=96&h=64&fit=crop&q=75' },
]

import { useEffect } from 'react'

export default function ProfilePanel({ darkMode: dm, toggleDark, isAuthenticated, user, onLogin, onLogout, onProfileUpdate }: Props) {
  const [notifs, setNotifs] = useState(true)
  const [locShare, setLocShare] = useState(false)

  const [isEditing, setIsEditing] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [emergencyContact, setEmergencyContact] = useState('')
  const [prefLanguage, setPrefLanguage] = useState('EN')
  const [kycLoading, setKycLoading] = useState(false)
  const [saveLoading, setSaveLoading] = useState(false)

  useEffect(() => {
    if (user) {
      setFullName(user.fullName || '')
      setEmail(user.email || '')
      setEmergencyContact(user.emergencyContact || '')
      setPrefLanguage(user.preferredLanguage || 'EN')
    }
  }, [user])

  const handleSaveProfile = async () => {
    if (!user) return
    setSaveLoading(true)
    try {
      const updated = await api.updateProfile(user.id, {
        full_name: fullName,
        email: email || null,
        emergency_contact: emergencyContact || null,
        preferred_language: prefLanguage,
      })
      onProfileUpdate({
        fullName: updated.full_name,
        email: updated.email || undefined,
        emergencyContact: updated.emergency_contact || undefined,
        preferredLanguage: updated.preferred_language || undefined,
      })
      setIsEditing(false)
    } catch (e) {
      console.error("Failed to save profile:", e)
      alert("Failed to save profile changes. Please try again.")
    } finally {
      setSaveLoading(false)
    }
  }

  const handleVerifyKyc = async () => {
    if (!user) return
    setKycLoading(true)
    try {
      // Simulate DigiLocker redirect / document check delay
      await new Promise(resolve => setTimeout(resolve, 1500))
      const updated = await api.updateProfile(user.id, {
        kyc_document_type: 'PASSPORT',
        kyc_verified: true,
      })
      onProfileUpdate({
        kycVerified: updated.kyc_verified,
      })
    } catch (e) {
      console.error("KYC verification failed:", e)
      alert("DigiLocker KYC verification failed. Please try again.")
    } finally {
      setKycLoading(false)
    }
  }

  const surface   = dm ? '#091222' : '#f4f6f9'
  const card      = dm ? '#0c1d33' : '#ffffff'
  const border    = dm ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)'
  const text      = dm ? '#f1f5f9' : '#0c2340'
  const subtle    = dm ? 'rgba(255,255,255,0.44)' : 'rgba(12,35,64,0.44)'
  const shadow    = dm ? '0 1px 8px rgba(0,0,0,0.35)' : '0 1px 8px rgba(0,0,0,0.06)'

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: surface, fontFamily: 'Inter, sans-serif' }}>

      {/* ── Profile hero ── */}
      <div className="px-5 pt-6 pb-5" style={{ borderBottom: `1px solid ${dm ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}` }}>
        {isAuthenticated && user ? (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold text-white flex-shrink-0"
                style={{ background: 'linear-gradient(135deg, #FF9933, #e67a0f)', boxShadow: '0 4px 16px rgba(255,153,51,0.35)' }}
              >
                {fullName ? fullName.charAt(0).toUpperCase() : 'T'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-lg font-bold truncate" style={{ color: text, fontFamily: 'Outfit, sans-serif' }}>
                  {fullName || 'Traveller'}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <Hash size={12} style={{ color: subtle }} />
                  <span className="text-xs font-mono truncate" style={{ color: subtle }}>Tourist ID: {user.id}</span>
                </div>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <div className={`w-2 h-2 rounded-full ${user.kycVerified ? 'bg-[#138808]' : 'bg-[#d97706]'}`} />
                  <span className="text-xs font-medium" style={{ color: user.kycVerified ? '#138808' : '#d97706' }}>
                    {user.kycVerified ? 'Verified tourist' : 'KYC Pending'}
                  </span>
                </div>
              </div>
            </div>

            {/* KYC Callout if not verified */}
            {!user.kycVerified && (
              <div 
                className="p-3.5 rounded-xl flex flex-col gap-2.5" 
                style={{ 
                  background: dm ? 'rgba(217,119,6,0.08)' : 'rgba(217,119,6,0.05)',
                  border: dm ? '1px solid rgba(217,119,6,0.2)' : '1px solid rgba(217,119,6,0.15)' 
                }}
              >
                <p className="text-xs leading-relaxed" style={{ color: dm ? '#fbbf24' : '#b45309' }}>
                  Complete identity verification to obtain your digital safety pass and unlock fast emergency clearance.
                </p>
                <button
                  onClick={handleVerifyKyc}
                  disabled={kycLoading}
                  className="w-full h-9 rounded-lg text-xs font-bold text-white flex items-center justify-center gap-2 bg-[#d97706] hover:bg-[#b45309] transition-all disabled:opacity-50"
                >
                  {kycLoading ? 'Verifying with DigiLocker...' : 'Verify with DigiLocker'}
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center py-4 gap-4">
            <div
              className="w-18 h-18 rounded-2xl flex items-center justify-center"
              style={{ background: dm ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)', width: 72, height: 72 }}
            >
              <User size={32} style={{ color: subtle }} />
            </div>
            <div className="text-center">
              <p className="text-base font-semibold" style={{ color: text }}>Not signed in</p>
              <p className="text-sm mt-1" style={{ color: subtle }}>Sign in with your Tourist ID to access all features</p>
            </div>
            <button
              onClick={onLogin}
              className="h-11 px-8 rounded-xl text-sm font-bold text-white transition-all hover:opacity-90 active:scale-95"
              style={{ background: '#FF9933', boxShadow: '0 3px 16px rgba(255,153,51,0.35)' }}
            >
              Sign in
            </button>
        )}
      </div>

      <div className="px-4 py-5 space-y-5">

        {/* ── Saved places ── */}
        {isAuthenticated && (
          <section>
            <SectionLabel text={text} label="Saved places" />
            <div className="flex gap-3 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1">
              {SAVED.map((s) => (
                <div
                  key={s.name}
                  className="flex-shrink-0 rounded-xl overflow-hidden"
                  style={{ width: 160, background: card, border: `1px solid ${border}`, boxShadow: shadow }}
                >
                  <img src={s.img} alt={s.name} className="w-full h-14 object-cover" />
                  <div className="p-2.5">
                    <p className="text-xs font-semibold truncate" style={{ color: text }}>{s.name}</p>
                    <p className="text-[10px] mt-0.5 truncate" style={{ color: subtle }}>{s.sub}</p>
                  </div>
                </div>
              ))}
              <div
                className="flex-shrink-0 rounded-xl flex flex-col items-center justify-center gap-1.5 cursor-pointer"
                style={{ width: 80, height: 108, background: dm ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)', border: `1.5px dashed ${border}` }}
              >
                <Bookmark size={18} style={{ color: subtle }} />
                <span className="text-[10px] text-center" style={{ color: subtle }}>Add place</span>
              </div>
            </div>
          </section>
        )}

        {/* ── Profile Details ── */}
        {isAuthenticated && user && (
          <section>
            <div className="flex items-center justify-between mb-2 px-1">
              <SectionLabel text={text} label="Profile details" />
              <button
                onClick={() => {
                  if (isEditing) {
                    handleSaveProfile()
                  } else {
                    setIsEditing(true)
                  }
                }}
                disabled={saveLoading}
                className="text-xs font-bold flex items-center gap-1 text-[#FF9933] hover:opacity-85 transition-opacity"
              >
                {saveLoading ? (
                  <span>Saving...</span>
                ) : isEditing ? (
                  <>
                    <Check size={13} />
                    <span>Save</span>
                  </>
                ) : (
                  <>
                    <Edit3 size={12} />
                    <span>Edit</span>
                  </>
                )}
              </button>
            </div>
            <div className="rounded-xl overflow-hidden" style={{ background: card, border: `1px solid ${border}`, boxShadow: shadow }}>
              {/* Full Name */}
              <div className="flex items-center justify-between px-4 py-3.5" style={{ borderBottom: `1px solid ${border}` }}>
                <span className="text-sm font-medium" style={{ color: subtle }}>Full name</span>
                {isEditing ? (
                  <input
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="text-sm text-right px-2 py-1 rounded border"
                    style={{ background: surface, border: `1px solid ${border}`, color: text, width: '160px' }}
                  />
                ) : (
                  <span className="text-sm font-semibold" style={{ color: text }}>{fullName || 'Not added'}</span>
                )}
              </div>

              {/* Email */}
              <div className="flex items-center justify-between px-4 py-3.5" style={{ borderBottom: `1px solid ${border}` }}>
                <span className="text-sm font-medium" style={{ color: subtle }}>Email</span>
                {isEditing ? (
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="text-sm text-right px-2 py-1 rounded border"
                    style={{ background: surface, border: `1px solid ${border}`, color: text, width: '160px' }}
                  />
                ) : (
                  <span className="text-sm font-semibold" style={{ color: text }}>{email || 'Not added'}</span>
                )}
              </div>

              {/* Phone */}
              <div className="flex items-center justify-between px-4 py-3.5" style={{ borderBottom: `1px solid ${border}` }}>
                <span className="text-sm font-medium" style={{ color: subtle }}>Phone</span>
                <span className="text-sm font-semibold" style={{ color: text }}>{user.phone || 'Not added'}</span>
              </div>

              {/* Preferred Language */}
              <div className="flex items-center justify-between px-4 py-3.5" style={{ borderBottom: `1px solid ${border}` }}>
                <span className="text-sm font-medium" style={{ color: subtle }}>Preferred language</span>
                {isEditing ? (
                  <select
                    value={prefLanguage}
                    onChange={(e) => setPrefLanguage(e.target.value)}
                    className="text-sm text-right px-2 py-1 rounded border"
                    style={{ background: surface, border: `1px solid ${border}`, color: text, width: '160px' }}
                  >
                    <option value="EN">English</option>
                    <option value="HI">Hindi (हिंदी)</option>
                    <option value="ES">Spanish (Español)</option>
                    <option value="FR">French (Français)</option>
                  </select>
                ) : (
                  <span className="text-sm font-semibold" style={{ color: text }}>
                    {prefLanguage === 'EN' ? 'English' : prefLanguage === 'HI' ? 'Hindi (हिंदी)' : prefLanguage === 'ES' ? 'Spanish (Español)' : prefLanguage === 'FR' ? 'French (Français)' : prefLanguage}
                  </span>
                )}
              </div>

              {/* Emergency Contact */}
              <div className="flex items-center justify-between px-4 py-3.5">
                <span className="text-sm font-medium" style={{ color: subtle }}>Emergency contact</span>
                {isEditing ? (
                  <input
                    type="text"
                    value={emergencyContact}
                    onChange={(e) => setEmergencyContact(e.target.value)}
                    className="text-sm text-right px-2 py-1 rounded border"
                    style={{ background: surface, border: `1px solid ${border}`, color: text, width: '160px' }}
                  />
                ) : (
                  <span className="text-sm font-semibold" style={{ color: text }}>{emergencyContact || 'Not added'}</span>
                )}
              </div>
            </div>
            {isEditing && (
              <div className="flex justify-end gap-2 mt-2 px-1">
                <button
                  onClick={() => setIsEditing(false)}
                  className="px-3 py-1 rounded text-xs font-semibold"
                  style={{ background: 'transparent', color: subtle }}
                >
                  Cancel
                </button>
              </div>
            )}
          </section>
        )}

        {/* ── Settings ── */}
        <section>
          <SectionLabel text={text} label="Settings" />
          <div className="rounded-xl overflow-hidden" style={{ background: card, border: `1px solid ${border}`, boxShadow: shadow }}>
            <ToggleRow
              icon={<Moon size={16} />} label="Dark mode" value={dm}
              onChange={toggleDark} text={text} subtle={subtle} border={border}
            />
            <ToggleRow
              icon={<Bell size={16} />} label="Safety notifications" value={notifs}
              onChange={() => setNotifs((v) => !v)} text={text} subtle={subtle} border={border}
            />
            <ToggleRow
              icon={<Wifi size={16} />} label="Share location with contacts" value={locShare}
              onChange={() => setLocShare((v) => !v)} text={text} subtle={subtle} border={border}
              last
            />
          </div>
        </section>

        {/* ── Help & safety ── */}
        <section>
          <SectionLabel text={text} label="Safety & support" />
          <div className="rounded-xl overflow-hidden" style={{ background: card, border: `1px solid ${border}`, boxShadow: shadow }}>
            <LinkRow icon={<Phone size={16} />}    label="Emergency helpline" sub="1363 — Tourism police" text={text} subtle={subtle} border={border} color="#dc2626" />
            <LinkRow icon={<Shield size={16} />}   label="Safety guidelines" sub="Travel smart in India"  text={text} subtle={subtle} border={border} />
            <LinkRow icon={<Globe size={16} />}    label="Tourism authority" sub="Ministry of Tourism, India" text={text} subtle={subtle} border={border} />
            <LinkRow icon={<HelpCircle size={16} />} label="Help & FAQ" sub="App support and guide"     text={text} subtle={subtle} border={border} last />
          </div>
        </section>

        {/* ── Account ── */}
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

        {/* Version */}
        <p className="text-center text-xs pb-4" style={{ color: dm ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.2)' }}>
          Suraksha Setu v2.0 · India Tourism Authority
        </p>
      </div>
    </div>
  )
}

function SectionLabel({ label, text }: { label: string; text: string }) {
  return (
    <p className="text-xs font-bold uppercase tracking-widest mb-2 px-1" style={{ color: text, letterSpacing: '0.07em', fontFamily: 'Inter, sans-serif', opacity: 0.55 }}>
      {label}
    </p>
  )
}

function ToggleRow({ icon, label, value, onChange, text, subtle, border, last }: {
  icon: React.ReactNode; label: string; value: boolean; onChange: () => void;
  text: string; subtle: string; border: string; last?: boolean
}) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3.5"
      style={{ borderBottom: last ? 'none' : `1px solid ${border}` }}
    >
      <span style={{ color: subtle }}>{icon}</span>
      <span className="flex-1 text-sm" style={{ color: text }}>{label}</span>
      <button
        onClick={onChange}
        className="relative w-11 h-6 rounded-full transition-all duration-200 flex-shrink-0"
        style={{ background: value ? '#FF9933' : subtle + '40' }}
        role="switch"
        aria-checked={value}
      >
        <span
          className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200"
          style={{ transform: value ? 'translateX(20px)' : 'translateX(0)' }}
        />
      </button>
    </div>
  )
}

function LinkRow({ icon, label, sub, text, subtle, border, color, last }: {
  icon: React.ReactNode; label: string; sub: string;
  text: string; subtle: string; border: string; color?: string; last?: boolean
}) {
  return (
    <button
      className="w-full flex items-center gap-3 px-4 py-3.5 text-left transition-colors"
      style={{ borderBottom: last ? 'none' : `1px solid ${border}` }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(128,128,128,0.05)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <span style={{ color: color || subtle }}>{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium" style={{ color: color || text }}>{label}</p>
        <p className="text-xs mt-0.5" style={{ color: subtle }}>{sub}</p>
      </div>
      <ChevronRight size={14} style={{ color: subtle }} />
    </button>
  )
}
