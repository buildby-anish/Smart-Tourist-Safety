import { useRef, useState, useEffect } from 'react';
import { MapPin, Utensils, Hotel, ShieldCheck, Building2, HeartPulse, Navigation, Flame, Users, ChevronLeft, ChevronRight } from 'lucide-react';

const CHIPS = [
  { id: null, label: 'Nearby', Icon: Navigation },
  { id: 'attraction', label: 'Attractions', Icon: MapPin },
  { id: 'restaurant', label: 'Restaurants', Icon: Utensils },
  { id: 'hotel', label: 'Hotels', Icon: Hotel },
  { id: 'safe', label: 'Safe Places', Icon: ShieldCheck },
  { id: 'police', label: 'Police', Icon: Building2 },
  { id: 'hospital', label: 'Hospitals', Icon: HeartPulse },
  { id: 'crowd', label: 'Crowd', Icon: Users },
  { id: 'alert', label: 'Alerts', Icon: Flame },
];

interface Props {
  darkMode: boolean;
  active: string | null;
  onChange: (id: string | null) => void;
}

export default function QuickActions({ darkMode: dm, active, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showLeft, setShowLeft] = useState(false);
  const [showRight, setShowRight] = useState(false);

  const checkScroll = () => {
    const el = containerRef.current;
    if (el) {
      const canScrollLeft = el.scrollLeft > 2;
      const canScrollRight = el.scrollLeft < el.scrollWidth - el.clientWidth - 2;
      setShowLeft(canScrollLeft);
      setShowRight(canScrollRight);
    }
  };

  useEffect(() => {
    const el = containerRef.current;
    if (el) {
      el.addEventListener('scroll', checkScroll);
      window.addEventListener('resize', checkScroll);
      checkScroll();
      const timer = setTimeout(checkScroll, 300);
      return () => {
        el.removeEventListener('scroll', checkScroll);
        window.removeEventListener('resize', checkScroll);
        clearTimeout(timer);
      };
    }
  }, []);

  const handleScroll = (dir: 'left' | 'right') => {
    const el = containerRef.current;
    if (el) {
      const amt = 200;
      el.scrollBy({
        left: dir === 'left' ? -amt : amt,
        behavior: 'smooth'
      });
    }
  };

  return (
    <div className="relative flex items-center group w-full">
      {showLeft && (
        <button
          onClick={() => handleScroll('left')}
          className="absolute left-0 z-30 w-8 h-8 rounded-full border flex items-center justify-center transition-all hover:scale-105 active:scale-95 shadow-md cursor-pointer"
          style={{
            background: dm ? '#18181b' : '#ffffff',
            borderColor: dm ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)',
            color: dm ? '#f1f5f9' : '#0c2340',
          }}
          aria-label="Scroll left"
        >
          <ChevronLeft size={16} />
        </button>
      )}

      <div
        ref={containerRef}
        className="flex gap-2 overflow-x-auto no-scrollbar scroll-smooth w-full py-0.5 px-0.5"
        style={{ scrollbarWidth: 'none' }}
      >
        {CHIPS.map(({ id, label, Icon }) => {
          const on = active === id;

          return (
            <button
              key={label}
              onClick={() => onChange(on ? null : id)}
              aria-pressed={on}
              className="flex items-center gap-1.5 px-3.5 py-[7px] rounded-full border text-xs font-medium whitespace-nowrap flex-shrink-0 transition-all duration-150 active:scale-95 cursor-pointer"
              style={{
                background: on
                  ? '#FF9933'
                  : dm ? 'rgba(10,20,40,0.88)' : 'rgba(255,255,255,0.94)',
                borderColor: on
                  ? '#FF9933'
                  : dm ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
                color: on ? '#ffffff' : dm ? 'rgba(255,255,255,0.8)' : '#0c2340',
                backdropFilter: 'blur(12px)',
                boxShadow: on
                  ? '0 2px 12px rgba(255,153,51,0.35)'
                  : `0 1px 6px rgba(0,0,0,${dm ? '0.4' : '0.08'})`,
              }}
            >
              <Icon size={12} strokeWidth={on ? 2.5 : 2} />
              {label}
            </button>
          );
        })}
      </div>

      {showRight && (
        <button
          onClick={() => handleScroll('right')}
          className="absolute right-0 z-30 w-8 h-8 rounded-full border flex items-center justify-center transition-all hover:scale-105 active:scale-95 shadow-md cursor-pointer"
          style={{
            background: dm ? '#18181b' : '#ffffff',
            borderColor: dm ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)',
            color: dm ? '#f1f5f9' : '#0c2340',
          }}
          aria-label="Scroll right"
        >
          <ChevronRight size={16} />
        </button>
      )}
    </div>
  );
}
