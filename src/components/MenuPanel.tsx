import React from 'react';
import { Music, History, ArrowRight } from 'lucide-react';

interface MenuPanelProps {
  onNavigate: (tab: 'analyzer' | 'history') => void;
  historyCount?: number;
}

export const MenuPanel: React.FC<MenuPanelProps> = ({
  onNavigate,
  historyCount = 0,
}) => {
  return (
    <div className="max-w-2xl mx-auto py-8 space-y-4">
      <div className="space-y-4">
        {/* BPM Analyzer & Player Heading Button */}
        <button
          type="button"
          onClick={() => onNavigate('analyzer')}
          className="w-full bg-slate-900 hover:bg-slate-800 border-2 border-slate-800 hover:border-emerald-500/60 rounded-2xl p-6 text-left transition-all cursor-pointer flex items-center justify-between group shadow-xl active:scale-[0.99]"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 group-hover:bg-emerald-500 group-hover:text-slate-950 transition-colors">
              <Music className="w-6 h-6" />
            </div>
            <span className="text-lg sm:text-xl font-bold text-slate-100 group-hover:text-emerald-400 transition-colors">
              BPM Analyzer & Player
            </span>
          </div>
          <ArrowRight className="w-5 h-5 text-slate-500 group-hover:text-emerald-400 group-hover:translate-x-1 transition-all" />
        </button>

        {/* History Log Heading Button */}
        <button
          type="button"
          onClick={() => onNavigate('history')}
          className="w-full bg-slate-900 hover:bg-slate-800 border-2 border-slate-800 hover:border-emerald-500/60 rounded-2xl p-6 text-left transition-all cursor-pointer flex items-center justify-between group shadow-xl active:scale-[0.99]"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 group-hover:bg-emerald-500 group-hover:text-slate-950 transition-colors">
              <History className="w-6 h-6" />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-lg sm:text-xl font-bold text-slate-100 group-hover:text-emerald-400 transition-colors">
                History Log
              </span>
              {historyCount > 0 && (
                <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  {historyCount}
                </span>
              )}
            </div>
          </div>
          <ArrowRight className="w-5 h-5 text-slate-500 group-hover:text-emerald-400 group-hover:translate-x-1 transition-all" />
        </button>
      </div>
    </div>
  );
};
