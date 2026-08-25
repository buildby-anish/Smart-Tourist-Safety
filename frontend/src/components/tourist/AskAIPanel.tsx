import { useEffect, useRef, useState } from 'react';
import { Sparkles, X, Send, ShieldAlert, MapPin, Hospital, Phone } from 'lucide-react';
import { listGeofences, askTravelAI, AIChatTurn } from '../../lib/api';
import { getSOSLocation } from '../../lib/location';
import { POIS } from './MapCanvas';
import { TouristUser } from '../../types';

interface Message {
  id: string;
  role: 'user' | 'ai';
  text: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  darkMode: boolean;
  user: TouristUser | null;
}

const QUICK_PROMPTS = [
  'Is this area safe right now?',
  'Nearest hospital',
  'Nearest police station',
  'Emergency numbers in India',
];

/**
 * Fallback safety assistant grounded in this app's own live data (geofence
 * zones from the backend, the static POI set the map already uses, and
 * the tourist's current location) — used when the real AI (askTravelAI,
 * backed by Groq's free API) isn't configured or fails. Kept as the
 * primary path for emergency-specific queries (hospital/police/emergency
 * numbers) even when the real AI IS available, since deterministic
 * answers matter more than an LLM's phrasing for those.
 */
async function generateFallbackReply(question: string, userLoc: { lat: number; lng: number } | null): Promise<string> {
  const q = question.toLowerCase();

  if (/hospital|medical|clinic|doctor/.test(q)) {
    const h = POIS.find((p) => p.type === 'hospital');
    return h
      ? `The nearest hospital on the map is ${h.label}. Tap the hospital marker (green +) on the map for directions, or use the SOS button if this is an emergency.`
      : `I don't have a hospital pinned near your current view. If this is an emergency, use the SOS button — it shares your live location with the nearest authority unit.`;
  }
  if (/police|station|officer/.test(q)) {
    const p = POIS.find((p) => p.type === 'police');
    return p
      ? `The nearest police station on the map is ${p.label}. Tap its marker for directions.`
      : `I don't have a police station pinned near your current view. For emergencies, dial 112 (India's unified emergency number) or use the SOS button.`;
  }
  if (/emergency number|helpline|call/.test(q)) {
    return `Key emergency numbers in India:\n• 112 — All-in-one emergency (police/fire/medical)\n• 1363 / 1800-11-1363 — Tourist helpline\n• 100 — Police\n• 108 — Ambulance\n\nIn an active emergency, the SOS button on this app also alerts the nearest tourism authority unit with your live location.`;
  }
  if (/safe|danger|risk|area/.test(q)) {
    try {
      const zones = await listGeofences(true);
      if (userLoc && zones?.length) {
        const toRad = (d: number) => (d * Math.PI) / 180;
        const distKm = (lat1: number, lng1: number, lat2: number, lng2: number) => {
          const R = 6371;
          const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
          const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
          return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        };
        const nearby = zones
          .map((z) => {
            const lats = z.coordinates.map((c) => c[1]);
            const lngs = z.coordinates.map((c) => c[0]);
            const cLat = lats.reduce((a, b) => a + b, 0) / lats.length;
            const cLng = lngs.reduce((a, b) => a + b, 0) / lngs.length;
            return { zone: z, d: distKm(userLoc.lat, userLoc.lng, cLat, cLng) };
          })
          .filter((z) => z.d < 3)
          .sort((a, b) => a.d - b.d)[0];
        if (nearby && nearby.zone.zone_type !== 'SAFE') {
          return `You're near a ${nearby.zone.zone_type.toLowerCase()} zone: "${nearby.zone.name}", about ${nearby.d.toFixed(1)} km away. Check the map's colored overlay for the exact boundary, and avoid restricted zones after dark.`;
        }
      }
      return `Based on current geofence data, no restricted or buffer zones are flagged right this moment near your area. Always check the map's colored zone overlay before heading somewhere unfamiliar — green is safe, amber is caution, red is restricted.`;
    } catch {
      return `I couldn't reach live zone data just now. As a general rule, stick to well-lit, populated areas and check the map's colored safety overlay before heading somewhere unfamiliar.`;
    }
  }
  return `I can help with nearby hospitals/police stations, emergency numbers, and whether your current area has any flagged safety zones. Try one of the quick prompts below, or ask me something like "is this area safe?"`;
}

export default function AskAIPanel({ open, onClose, darkMode: dm, user }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    { id: 'welcome', role: 'ai', text: `Hi${user?.full_name ? ` ${user.full_name.split(' ')[0]}` : ''}! I can help with nearby help points, safety zones, and emergency numbers. What do you need?` },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    getSOSLocation().then((loc) => {
      if (loc.latitude != null && loc.longitude != null) setUserLoc({ lat: loc.latitude, lng: loc.longitude });
    }).catch(() => {});
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // Emergency-specific queries always use the deterministic fallback, even
  // when the real AI is available — a hallucinated hospital name or wrong
  // emergency number is a much worse failure mode here than everywhere else.
  const EMERGENCY_RE = /hospital|medical|clinic|doctor|police|station|officer|emergency number|helpline/i;

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setMessages((m) => [...m, { id: `u-${Date.now()}`, role: 'user', text: trimmed }]);
    setInput('');
    setSending(true);
    try {
      let reply: string;
      if (EMERGENCY_RE.test(trimmed)) {
        reply = await generateFallbackReply(trimmed, userLoc);
      } else {
        try {
          const history: AIChatTurn[] = messages
            .filter((m) => m.id !== 'welcome')
            .slice(-6)
            .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }));
          reply = await askTravelAI(trimmed, history);
        } catch (err) {
          // No GROQ_API_KEY configured (503), Groq unreachable/erroring
          // (502), or a network error — fall back rather than show a
          // broken chat. Genuinely unexpected errors still fall back here
          // too since a wrong-but-safe fallback beats a dead panel.
          console.error("AskAI request failed:", err);
          reply = await generateFallbackReply(trimmed, userLoc);
        }
      }
      setMessages((m) => [...m, { id: `a-${Date.now()}`, role: 'ai', text: reply }]);
    } finally {
      setSending(false);
    }
  };

  const surface = dm ? '#18181b' : '#ffffff';
  const text = dm ? '#f1f5f9' : '#0c2340';
  const subtle = dm ? 'rgba(255,255,255,0.5)' : 'rgba(12,35,64,0.55)';
  const border = dm ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-[90]" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose} />
      <div
        className="fixed inset-x-0 bottom-0 z-[95] rounded-t-3xl flex flex-col animate-slide-up"
        style={{ height: '50vh', background: surface, boxShadow: '0 -8px 40px rgba(0,0,0,0.35)' }}
      >
        <div className="flex items-center justify-between px-5 pt-4 pb-3" style={{ borderBottom: `1px solid ${border}` }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #FF9933, #e67a0f)' }}>
              <Sparkles size={15} style={{ color: '#fff' }} />
            </div>
            <div>
              <p className="text-sm font-bold leading-none" style={{ color: text, fontFamily: 'Outfit, sans-serif' }}>Ask AI</p>
              <p className="text-[11px] mt-0.5" style={{ color: subtle }}>Safety assistant</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-full flex items-center justify-center transition-opacity hover:opacity-70" style={{ background: dm ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}>
            <X size={14} style={{ color: subtle }} />
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className="max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-line"
                style={{
                  background: m.role === 'user' ? '#FF9933' : dm ? 'rgba(255,255,255,0.06)' : 'rgba(12,35,64,0.05)',
                  color: m.role === 'user' ? '#fff' : text,
                }}
              >
                {m.text}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="rounded-2xl px-3.5 py-2.5" style={{ background: dm ? 'rgba(255,255,255,0.06)' : 'rgba(12,35,64,0.05)' }}>
                <span className="flex gap-1">
                  <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: subtle }} />
                  <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: subtle, animationDelay: '0.15s' }} />
                  <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: subtle, animationDelay: '0.3s' }} />
                </span>
              </div>
            </div>
          )}
        </div>

        {messages.length <= 1 && (
          <div className="px-4 pb-2 flex flex-wrap gap-2">
            {QUICK_PROMPTS.map((p) => (
              <button
                key={p}
                onClick={() => send(p)}
                className="text-xs px-3 py-1.5 rounded-full transition-opacity hover:opacity-75"
                style={{ background: dm ? 'rgba(255,255,255,0.06)' : 'rgba(12,35,64,0.05)', color: text, border: `1px solid ${border}` }}
              >
                {p}
              </button>
            ))}
          </div>
        )}

        <div className="px-4 pb-[calc(env(safe-area-inset-bottom,0px)+14px)] pt-2 flex items-center gap-2" style={{ borderTop: `1px solid ${border}` }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') send(input); }}
            placeholder="Ask about safety, nearby help..."
            className="flex-1 h-11 rounded-full px-4 text-sm outline-none"
            style={{ background: dm ? 'rgba(255,255,255,0.06)' : 'rgba(12,35,64,0.05)', color: text }}
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || sending}
            aria-label="Send"
            className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 transition-opacity disabled:opacity-40"
            style={{ background: '#FF9933', color: '#fff' }}
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </>
  );
}
