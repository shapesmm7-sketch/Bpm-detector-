import React from 'react';
import { Menu, X } from 'lucide-react';

interface HeaderProps {
  activeTab: 'analyzer' | 'menu' | 'history';
  setActiveTab: (tab: 'analyzer' | 'menu' | 'history') => void;
  activeSection?: 'home' | 'audio' | 'video' | 'phone-manager';
  onSelectHome?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  activeSection = 'home',
  onSelectHome,
}) => {
  const isHomeMenuOpen = activeSection === 'home' && activeTab === 'menu';

  const statusLabel =
    activeSection === 'audio'
      ? 'Audio Player'
      : activeSection === 'video'
      ? 'Video Player'
      : activeSection === 'phone-manager'
      ? 'Phone Manager'
      : activeTab === 'menu'
      ? 'Menu'
      : activeTab === 'history'
      ? 'History'
      : null;

  return (
    <header className="flex items-center justify-between gap-4 px-4 sm:px-6 py-3.5 border-b border-slate-200/80 dark:border-slate-800/80 bg-white/95 dark:bg-slate-950/95 backdrop-blur-md sticky top-0 z-50 transition-colors">
      {/* Left Side: Brand Logo Icon + Mo Vibe Wordmark */}
      <a
        href="#"
        onClick={(e) => {
          e.preventDefault();
          onSelectHome?.();
          setActiveTab('analyzer');
        }}
        className="flex items-center gap-3 whitespace-nowrap shrink-0 hover:opacity-90 transition-opacity"
      >
        <span
          className="w-9 h-9 rounded-xl bg-emerald-500 flex items-center justify-center shadow-sm shadow-emerald-500/25 shrink-0"
          aria-hidden="true"
        >
          <span className="flex items-center gap-0.5 h-4">
            <span className="w-[2.5px] h-2 rounded-full bg-slate-950" />
            <span className="w-[2.5px] h-4 rounded-full bg-slate-950" />
            <span className="w-[2.5px] h-2.5 rounded-full bg-slate-950" />
            <span className="w-[2.5px] h-3.5 rounded-full bg-slate-950" />
          </span>
        </span>
        <span className="text-lg sm:text-xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          Mo Vibe
        </span>
      </a>

      {/* Right Side: Active section label (on sub-views) + Menu Toggle Button */}
      <div className="flex items-center gap-3 shrink-0">
        {statusLabel && (
          <span className="hidden sm:inline text-xs font-mono text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wide whitespace-nowrap">
            {statusLabel}
          </span>
        )}
        <button
          type="button"
          onClick={() => {
            onSelectHome?.();
            if (activeSection !== 'home') {
              setActiveTab('menu');
            } else {
              setActiveTab(activeTab === 'menu' ? 'analyzer' : 'menu');
            }
          }}
          className={`min-h-[44px] min-w-[44px] p-2.5 rounded-xl border transition-all cursor-pointer active:scale-95 flex items-center justify-center ${
            isHomeMenuOpen
              ? 'bg-emerald-500/15 dark:bg-emerald-500/20 border-emerald-500/50 text-emerald-600 dark:text-emerald-400'
              : 'bg-slate-100 dark:bg-slate-900 hover:bg-slate-200 dark:hover:bg-slate-800 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200'
          }`}
          aria-label="Toggle Menu Page"
          title={isHomeMenuOpen ? 'Close Menu' : 'Open Menu Page'}
        >
          {isHomeMenuOpen ? (
            <X className="w-5 h-5" />
          ) : (
            <Menu className="w-5 h-5" />
          )}
        </button>
      </div>
    </header>
  );
};
