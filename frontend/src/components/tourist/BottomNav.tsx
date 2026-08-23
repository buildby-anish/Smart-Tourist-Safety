import { Map, Compass, Route, User } from 'lucide-react';
import React from 'react';

const LEFT_TABS = [
  { id: 'map', label: 'Map', Icon: Map, protected: false },
  { id: 'explore', label: 'Explore', Icon: Compass, protected: false },
];

const RIGHT_TABS = [
  { id: 'trips', label: 'Trips', Icon: Route, protected: true },
  { id: 'profile', label: 'Profile', Icon: User, protected: false },
];

interface Props {
  active: string;
  darkMode: boolean;
  onChange: (id: string) => void;
  onProtected: (id: string) => void;
  isAuthenticated: boolean;
  /** The SOS trigger button, rendered as the elevated center action. */
  sosButton?: React.ReactNode;
}

export default function BottomNav({ active, darkMode: dm, onChange, onProtected, isAuthenticated, sosButton }: Props) {
  const bg = dm ? '#0a1628' : '#ffffff';
  const border = dm ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)';

  const handle = (id: string, prot: boolean) => {
    if (prot && !isAuthenticated) { onProtected(id); return; }
    onChange(id);
  };

  const renderTab = ({ id, label, Icon, protected: prot }: (typeof LEFT_TABS)[0]) => {
    const on = active === id;
    const iconC = on ? '#FF9933' : dm ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.38)';
    const textC = on ? '#FF9933' : dm ? 'rgba(255,255,255,0.38)' : 'rgba(0,0,0,0.35)';

    return (
      <button
        key={id}
        onClick={() => handle(id, prot)}
        aria-label={label}
        aria-current={on ? 'page' : undefined}
        className="flex-1 h-full min-w-[56px] flex flex-col items-center justify-center gap-[5px] pt-2 pb-1.5 relative transition-all duration-100 active:scale-95"
      >
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 rounded-full transition-all duration-200"
          style={{ width: on ? 28 : 0, height: 2.5, background: '#FF9933', opacity: on ? 1 : 0 }}
        />

        <div className="relative">
          <Icon size={20} strokeWidth={on ? 2.5 : 1.8} style={{ color: iconC, transition: 'color 0.15s, stroke-width 0.15s' }} />
          {prot && !isAuthenticated && (
            <span
              className="absolute -top-0.5 -right-1.5 w-2 h-2 rounded-full"
              style={{ background: dm ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.15)', border: `1.5px solid ${bg}` }}
            />
          )}
        </div>

        <span className="text-[10px] font-medium leading-none" style={{ color: textC, transition: 'color 0.15s' }}>
          {label}
        </span>
      </button>
    );
  };

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 flex items-stretch"
      style={{
        background: bg,
        borderTop: `1px solid ${border}`,
        boxShadow: `0 -4px 24px rgba(0,0,0,${dm ? '0.45' : '0.08'})`,
        paddingBottom: 'env(safe-area-inset-bottom, 6px)',
        minHeight: 64,
      }}
      aria-label="Main navigation"
    >
      {LEFT_TABS.map(renderTab)}

      {/* Center SOS action — elevated above the bar, Apple-style */}
      <div className="flex-1 min-w-[64px] flex items-center justify-center relative">
        <div className="absolute" style={{ top: -22 }}>
          {sosButton}
        </div>
      </div>

      {RIGHT_TABS.map(renderTab)}
    </nav>
  );
}
