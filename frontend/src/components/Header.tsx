import React from 'react';
import {
  Brain,
  UserCheck,
  MapPin,
  Radio,
  BarChart3,
  Search,
  Globe,
  Sun,
  Moon,
  LogOut,
  ShieldAlert
} from 'lucide-react';
import { Language, UserRole, ActiveModule } from '../types';
import { i18n } from '../data/i18n';
import BrandMark from './BrandMark';

interface HeaderProps {
  language: Language;
  onLanguageChange: (lang: Language) => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  userRole: UserRole;
  onLogout: () => void;
  onLogoClick: () => void;
  activeModule: ActiveModule;
  onSelectModule: (mod: ActiveModule) => void;
  globalSearchQuery: string;
  onGlobalSearchChange: (q: string) => void;
  onExecuteGlobalSearch: () => void;
  activeSosCount: number;
  isAuthenticatedTourist?: boolean;
  touristName?: string | null;
  onLoginClick?: () => void;
  onSignUpClick?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  language,
  onLanguageChange,
  darkMode,
  onToggleDarkMode,
  userRole,
  onLogout,
  onLogoClick,
  activeModule,
  onSelectModule,
  globalSearchQuery,
  onGlobalSearchChange,
  onExecuteGlobalSearch,
  activeSosCount,
  isAuthenticatedTourist = false,
  touristName = null,
  onLoginClick = () => {},
  onSignUpClick = () => {}
}) => {
  const t = i18n[language];

  const navItems = [
    {
      id: 'ai_hub' as ActiveModule,
      icon: Brain,
      titleEn: 'AI Anomaly & Prediction Hub',
      badge: 'AI ACTIVE',
      badgeStyle: 'bg-amber-500/20 text-[#FF9933] border-amber-500/40'
    },
    {
      id: 'tourist_tracking' as ActiveModule,
      icon: UserCheck,
      titleEn: 'Tourist Detail Tracking',
      badge: null,
      badgeStyle: ''
    },
    {
      id: 'sos_map' as ActiveModule,
      icon: MapPin,
      titleEn: 'SOS Alert & Command Map',
      badge: `${activeSosCount} SOS`,
      badgeStyle: 'bg-red-500/20 text-red-400 border-red-500/40 font-black animate-pulse'
    },
    {
      id: 'broadcast' as ActiveModule,
      icon: Radio,
      titleEn: 'Broadcast & Geofenced Alerts',
      badge: null,
      badgeStyle: ''
    },
    {
      id: 'analytics_audit' as ActiveModule,
      icon: BarChart3,
      titleEn: 'Audit Logs & Analytics',
      badge: null,
      badgeStyle: ''
    }
  ];

  return (
    <header className="sticky top-0 z-50 bg-[#0C2340] text-white shadow-md border-b border-slate-800 pt-[env(safe-area-inset-top,0px)]">
      <div className="h-0.5 w-full flex">
        <div className="h-full w-1/3 bg-[#FF9933]"></div>
        <div className="h-full w-1/3 bg-white"></div>
        <div className="h-full w-1/3 bg-[#138808]"></div>
      </div>

      <div className="max-w-[1700px] mx-auto px-3 sm:px-4">
        <div className="h-12 flex items-center gap-2 min-h-0">
          <button
            type="button"
            className="flex items-center gap-2 flex-shrink-0 cursor-pointer group"
            onClick={() => {
              onLogoClick();
              if (userRole === 'authority') onSelectModule('ai_hub');
            }}
            aria-label="Suraksha Setu home"
          >
            <BrandMark size={32} className="group-hover:scale-105 transition-transform" />
            {userRole === 'authority' && (
              <span className="hidden xl:inline text-[11px] font-bold tracking-wider text-white/90 uppercase whitespace-nowrap">
                Suraksha Setu
              </span>
            )}
          </button>

          {userRole === 'authority' && (
            <div className="flex items-center space-x-1 overflow-x-auto flex-1 min-w-0 py-0 no-scrollbar">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeModule === item.id;

                return (
                  <button
                    key={item.id}
                    onClick={() => onSelectModule(item.id)}
                    className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg text-left transition-all duration-200 flex-shrink-0 cursor-pointer hover:scale-[1.03] active:scale-[0.97] ${
                      isActive
                        ? 'bg-[#153462] border border-[#234F8C] shadow-md ring-1 ring-[#FF9933]/40'
                        : 'bg-transparent hover:bg-white/5 text-slate-300 hover:text-white border border-transparent'
                    }`}
                  >
                    <Icon
                      className={`w-3.5 h-3.5 flex-shrink-0 ${
                        isActive ? 'text-[#FF9933]' : 'text-slate-300'
                      }`}
                    />
                    <span
                      className={`text-[11px] whitespace-nowrap font-bold ${
                        isActive ? 'text-white' : 'text-slate-200'
                      }`}
                    >
                      {item.titleEn}
                    </span>

                    {item.badge && (
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded border uppercase tracking-wider font-extrabold ${item.badgeStyle}`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          <div className={`flex items-center gap-2 min-w-0 ${userRole === 'authority' ? 'ml-1' : 'ml-auto'} justify-end`}>
            {userRole === 'authority' && (
              <div className="relative hidden md:block">
                <input
                  type="text"
                  placeholder="Search districts or schemes..."
                  value={globalSearchQuery}
                  onChange={(e) => onGlobalSearchChange(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && onExecuteGlobalSearch()}
                  className="w-44 lg:w-64 pl-8 pr-8 py-1 text-xs rounded-full bg-white/95 border border-white/20 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#FF9933] focus:ring-1 focus:ring-[#FF9933] shadow-sm font-medium"
                />
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1.5" />
                {globalSearchQuery && (
                  <button
                    onClick={onExecuteGlobalSearch}
                    className="absolute right-1.5 top-1 px-2 py-0.5 bg-[#0C2340] text-white text-[10px] font-bold rounded-full hover:bg-slate-800"
                  >
                    GO
                  </button>
                )}
              </div>
            )}

            {userRole === 'authority' && activeSosCount > 0 && (
              <button
                onClick={() => onSelectModule('sos_map')}
                className="hidden sm:flex items-center space-x-1 bg-red-600 hover:bg-red-700 text-white px-2 py-1 rounded-full text-[10px] font-black shadow-sm border border-red-400/40 whitespace-nowrap animate-pulse transition-all cursor-pointer"
              >
                <ShieldAlert className="w-3 h-3 text-white" />
                <span>{activeSosCount} SOS</span>
              </button>
            )}

            {userRole === 'authority' ? (
              <div className="hidden lg:flex items-center space-x-2 border-l border-white/15 pl-2">
                <img
                  src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80"
                  alt="Rajesh Kumar, IAS"
                  className="w-7 h-7 rounded-full border border-white/20 object-cover flex-shrink-0"
                />
                <div className="flex flex-col leading-tight">
                  <span className="text-[11px] font-extrabold text-white whitespace-nowrap">
                    Rajesh Kumar, IAS
                  </span>
                  <span className="text-[9px] text-slate-300 font-medium whitespace-nowrap">
                    State Chief Administrator
                  </span>
                </div>
              </div>
            ) : userRole === 'tourist' && isAuthenticatedTourist ? (
              <div className="flex items-center space-x-2">
                <div className="w-7 h-7 rounded-full border border-[#FF9933]/50 bg-[#153462] flex items-center justify-center flex-shrink-0 text-white font-black text-[11px]">
                  {(touristName || 'T').substring(0, 1).toUpperCase()}
                </div>
                <span className="hidden sm:inline text-[11px] font-bold text-white/90 whitespace-nowrap max-w-[120px] truncate">
                  {touristName || 'Tourist'}
                </span>
              </div>
            ) : null}

            <div className="flex items-center space-x-1.5">
              {userRole === 'tourist' && !isAuthenticatedTourist && (
                <div className="flex items-center space-x-1.5 mr-0.5">
                  <button
                    onClick={onLoginClick}
                    className="px-2.5 py-1 text-[11px] font-bold rounded-md border border-white/20 hover:border-white/40 text-white/90 hover:text-white transition-all cursor-pointer hover:bg-white/10"
                  >
                    Login
                  </button>
                  <button
                    onClick={onSignUpClick}
                    className="px-2.5 py-1 text-[11px] font-bold rounded-md bg-[#FF9933] text-white hover:bg-[#e68a2e] shadow-sm transition-all cursor-pointer"
                  >
                    Sign Up
                  </button>
                </div>
              )}

              <div className="flex items-center bg-white/10 border border-white/15 rounded-md p-0.5 gap-0.5">
                <Globe className="w-3 h-3 text-slate-300 ml-1 hidden sm:block" />
                <button
                  onClick={() => onLanguageChange('en')}
                  className={`px-1.5 py-0.5 text-[10px] font-extrabold rounded ${
                    language === 'en'
                      ? 'bg-white text-[#0C2340] shadow-xs'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  EN
                </button>
                <button
                  onClick={() => onLanguageChange('hi')}
                  className={`px-1.5 py-0.5 text-[10px] font-extrabold rounded ${
                    language === 'hi'
                      ? 'bg-white text-[#0C2340] shadow-xs'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  हिंदी
                </button>
              </div>

              <button
                onClick={onToggleDarkMode}
                className="p-1.5 rounded-md bg-white/10 border border-white/15 text-slate-200 hover:bg-white/15 transition-all duration-200 hover:scale-105 active:scale-95"
                title="Toggle High-Contrast Theme"
              >
                {darkMode ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-slate-200" />}
              </button>

              {(userRole === 'authority' || (userRole === 'tourist' && isAuthenticatedTourist)) && (
                <button
                  onClick={onLogout}
                  className="p-1.5 rounded-md bg-red-500/15 hover:bg-red-500/25 border border-red-400/30 text-red-200 transition-all duration-200 hover:scale-105 active:scale-95"
                  title={t.logoutBtn}
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
