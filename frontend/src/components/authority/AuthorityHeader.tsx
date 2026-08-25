import { Sun, Moon, LogOut, ShieldAlert, Users, Radio, Search, Globe } from 'lucide-react';
import { Language } from '../../types';
import { i18n } from '../../data/i18n';
import BrandMark from '../BrandMark';

interface Props {
  language: Language;
  onLanguageChange: (lang: Language) => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onLogout: () => void;
  officerName: string;
  activeSosCount: number;
  touristsTrackedCount: number;
  patrolUnitsOnlineCount: number;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onExecuteSearch: () => void;
  onSosCounterClick: () => void;
}

export default function AuthorityHeader({
  language, onLanguageChange, darkMode: dm, onToggleDarkMode, onLogout,
  officerName, activeSosCount, touristsTrackedCount, patrolUnitsOnlineCount,
  searchQuery, onSearchChange, onExecuteSearch, onSosCounterClick,
}: Props) {
  const t = i18n[language];

  return (
    <header className="absolute top-0 inset-x-0 z-30 pt-[env(safe-area-inset-top,0px)]">
      <div className="h-0.5 w-full flex">
        <div className="h-full w-1/3 bg-[#FF9933]" />
        <div className="h-full w-1/3 bg-white" />
        <div className="h-full w-1/3 bg-[#138808]" />
      </div>
      <div
        className="flex items-center gap-3 px-3 sm:px-4 h-14"
        style={{ background: dm ? 'rgba(10,20,40,0.92)' : 'rgba(11,36,71,0.94)', backdropFilter: 'blur(12px)' }}
      >
        <div className="flex items-center gap-2 flex-shrink-0">
          <BrandMark size={28} />
          <span className="hidden lg:inline text-[11px] font-extrabold tracking-widest text-white/90 uppercase whitespace-nowrap">
            {t.authorityCommandLabel}
          </span>
        </div>

        {/* Live counters — always visible, not buried in a tab */}
        <div className="hidden md:flex items-center gap-2 flex-shrink-0">
          <button
            onClick={onSosCounterClick}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-black border transition-all ${
              activeSosCount > 0
                ? 'bg-red-600 border-red-400/50 text-white animate-pulse-glow cursor-pointer'
                : 'bg-white/5 border-white/10 text-white/50'
            }`}
          >
            <ShieldAlert size={12} />
            <span>{activeSosCount} SOS</span>
          </button>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-white/8 border border-white/10 text-white/85">
            <Users size={12} className="text-[#FF9933]" />
            <span>{touristsTrackedCount}</span>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-white/8 border border-white/10 text-white/85">
            <Radio size={12} className="text-blue-300" />
            <span>{patrolUnitsOnlineCount}</span>
          </div>
        </div>

        <div className="relative flex-1 min-w-0 hidden sm:block">
          <input
            type="text"
            placeholder="Search tourist ID / incident..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onExecuteSearch()}
            className="w-full max-w-xs pl-8 pr-3 py-1.5 text-xs rounded-full bg-white/95 border border-white/20 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-[#FF9933] font-medium"
          />
          <Search size={13} className="text-slate-400 absolute left-2.5 top-2" />
        </div>

        <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
          <span className="hidden xl:inline text-[11px] font-bold text-white/85 whitespace-nowrap max-w-[140px] truncate mr-1">
            {officerName}
          </span>
          <div className="flex items-center bg-white/10 border border-white/15 rounded-md p-0.5 gap-0.5">
            <Globe size={11} className="text-slate-300 ml-1 hidden sm:block" />
            <button onClick={() => onLanguageChange('en')} className={`px-1.5 py-0.5 text-[10px] font-extrabold rounded ${language === 'en' ? 'bg-white text-[#0C2340]' : 'text-slate-300 hover:text-white'}`}>EN</button>
            <button onClick={() => onLanguageChange('hi')} className={`px-1.5 py-0.5 text-[10px] font-extrabold rounded ${language === 'hi' ? 'bg-white text-[#0C2340]' : 'text-slate-300 hover:text-white'}`}>हिंदी</button>
          </div>
          <button onClick={onToggleDarkMode} className="p-1.5 rounded-md bg-white/10 border border-white/15 text-slate-200 hover:bg-white/15 transition-all">
            {dm ? <Sun size={14} className="text-amber-400" /> : <Moon size={14} />}
          </button>
          <button onClick={onLogout} className="p-1.5 rounded-md bg-red-500/15 hover:bg-red-500/25 border border-red-400/30 text-red-200 transition-all" title={t.logoutBtn}>
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </header>
  );
}
