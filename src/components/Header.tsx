import React from 'react';
import { Menu, X } from 'lucide-react';

interface HeaderProps {
  activeTab: 'analyzer' | 'menu' | 'history';
  setActiveTab: (tab: 'analyzer' | 'menu' | 'history') => void;
  activeSection?: 'home' | 'audio' | 'video';
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
      : activeTab === 'menu'
      ? 'Menu Page'
      : activeTab === 'history'
      ? 'History View'
      : 'BPM Analyzer';

  return (
    <header className="flex items-center justify-between gap-4 px-4 sm:px-6 py-3.5 border-b border-slate-800 bg-slate-950/90 backdrop-blur-md sticky top-0 z-50">
      <div className="flex items-center gap-3">
        {/* Left Side: 3-Lines Menu Icon Button */}
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
          className={`p-2.5 rounded-xl border transition-all cursor-pointer shadow-sm active:scale-95 flex items-center justify-center ${
            isHomeMenuOpen
              ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400'
              : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-200'
          }`}
          aria-label="Toggle Menu Page"
          title={isHomeMenuOpen ? 'Close Menu' : 'Open Menu Page'}
        >
          {isHomeMenuOpen ? (
            <X className="w-5 h-5 text-emerald-400" />
          ) : (
            <Menu className="w-5 h-5 text-emerald-400" />
          )}
        </button>

        {/* Brand Wordmark */}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            onSelectHome?.();
            setActiveTab('analyzer');
          }}
          className="text-lg font-extrabold tracking-tight text-white flex items-center gap-2 whitespace-nowrap hover:opacity-90 transition-opacity"
        >
          <span className="bg-gradient-to-r from-white via-slate-100 to-slate-300 bg-clip-text text-transparent hidden sm:inline">
            PulseBPM Studio
          </span>
        </a>
      </div>

      {/* Active View Status Label */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-slate-400 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-slate-300 font-semibold uppercase text-[10px] font-mono">
            {statusLabel}
          </span>
        </span>
      </div>
    </header>
  );
};
