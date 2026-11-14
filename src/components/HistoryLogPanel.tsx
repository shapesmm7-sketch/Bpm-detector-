import React from 'react';
import { History, Trash2, Music, ArrowLeft } from 'lucide-react';

export interface HistoryItem {
  id: string;
  name: string;
  bpm: number;
  durationSec: number;
  confidence: number;
  timestamp: number;
  sourceUri?: string;
  displayName?: string;
}

interface HistoryLogPanelProps {
  history: HistoryItem[];
  onClearHistory: () => void;
  onRemoveItem: (id: string) => void;
  onSelectItem: (item: HistoryItem) => void;
  loadingItemId?: string | null;
  onBackToAnalyzer?: () => void;
}

export const HistoryLogPanel: React.FC<HistoryLogPanelProps> = ({
  history,
  onClearHistory,
  onRemoveItem,
  onSelectItem,
  loadingItemId,
  onBackToAnalyzer,
}) => {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-5">
      {/* Page Header Bar */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          {onBackToAnalyzer && (
            <button
              type="button"
              onClick={onBackToAnalyzer}
              className="p-2 rounded-xl bg-slate-950 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 transition-colors cursor-pointer flex items-center gap-1.5 text-xs font-semibold"
              title="Return to BPM Analyzer"
            >
              <ArrowLeft className="w-4 h-4 text-emerald-400" />
              <span>Back to Analyzer</span>
            </button>
          )}
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-emerald-400" />
            <h2 className="font-bold text-slate-100 text-base">Session Track Analysis History</h2>
          </div>
        </div>
        {history.length > 0 && (
          <button
            type="button"
            onClick={onClearHistory}
            className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 font-medium transition-colors cursor-pointer bg-red-500/10 px-3 py-1.5 rounded-lg border border-red-500/20"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear History
          </button>
        )}
      </div>

      {history.length === 0 ? (
        <div className="py-8 text-center text-slate-500 text-xs font-medium space-y-1">
          <Music className="w-8 h-8 text-slate-700 mx-auto mb-2" />
          <p>No tracks analyzed in this session yet.</p>
          <p className="text-slate-600">Upload any song above to detect its BPM instantly.</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
          {history.map((item) => {
            const isLoading = loadingItemId === item.id;
            return (
              <div
                key={item.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectItem(item)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectItem(item);
                  }
                }}
                className="flex items-center justify-between p-3 rounded-lg bg-slate-950 border border-slate-800 hover:border-emerald-500/50 hover:bg-slate-900/80 active:scale-[0.99] transition-all cursor-pointer"
                title={`Open ${item.name} in Analyzer`}
              >
                <div className="space-y-0.5 min-w-0 pr-2">
                  <span className="font-semibold text-slate-200 text-xs block truncate max-w-xs">
                    {item.name}
                  </span>
                  <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono">
                    <span>{Math.floor(item.durationSec / 60)}m {Math.round(item.durationSec % 60)}s</span>
                    <span>·</span>
                    <span>{new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    {isLoading ? (
                      <div className="w-4 h-4 border-2 border-emerald-500/30 border-t-emerald-400 rounded-full animate-spin ml-auto" />
                    ) : (
                      <span className="font-mono font-extrabold text-emerald-400 text-sm block">
                        {item.bpm} BPM
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveItem(item.id);
                    }}
                    className="p-2 text-slate-500 hover:text-red-400 transition-colors rounded hover:bg-slate-900 cursor-pointer"
                    title="Remove from log"
                    aria-label={`Remove ${item.name} from history`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
