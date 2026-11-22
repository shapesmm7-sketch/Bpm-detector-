import React, { useState, useEffect } from 'react';
import {
  Inbox,
  Paperclip,
  Clock,
  Tag,
  MailOpen,
  ShieldAlert,
  UserX,
  Search,
  Trash2,
  Archive,
  CheckSquare,
  Square,
  LogOut,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Loader2,
} from 'lucide-react';
import {
  ConnectedEmailAccount,
  EmailBulkAction,
  EmailFilterView,
  EmailMessageSummary,
  connectGmailAccount,
  disconnectEmailAccount,
  fetchProviderEmails,
  isAccountTokenValid,
  performBulkEmailAction,
} from '../../utils/emailAuthAndApi';
import { formatBytes } from '../../plugins/phoneManager';

interface EmailManagerViewProps {
  accounts: ConnectedEmailAccount[];
  onAccountsChanged: () => void;
}

const VIEW_TABS: Array<{ id: EmailFilterView; label: string; icon: React.ReactNode }> = [
  { id: 'inbox', label: 'Inbox', icon: <Inbox className="w-3.5 h-3.5" /> },
  { id: 'unread', label: 'Unread', icon: <MailOpen className="w-3.5 h-3.5" /> },
  { id: 'large_attachments', label: 'Large Attachments', icon: <Paperclip className="w-3.5 h-3.5" /> },
  { id: 'old_emails', label: 'Old Cleaner', icon: <Clock className="w-3.5 h-3.5" /> },
  { id: 'promotions', label: 'Promotions', icon: <Tag className="w-3.5 h-3.5" /> },
  { id: 'spam', label: 'Spam', icon: <ShieldAlert className="w-3.5 h-3.5" /> },
  { id: 'unsubscribe', label: 'Unsubscribe', icon: <UserX className="w-3.5 h-3.5" /> },
];

export const EmailManagerView: React.FC<EmailManagerViewProps> = ({
  accounts,
  onAccountsChanged,
}) => {
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [activeView, setActiveView] = useState<EmailFilterView>('inbox');
  const [readFilter, setReadFilter] = useState<'all' | 'unread' | 'read'>('all');
  const [olderThanDays, setOlderThanDays] = useState<number>(90);
  const [customBeforeDate, setCustomBeforeDate] = useState<string>('');
  const [searchInput, setSearchInput] = useState<string>('');
  const [activeSearchQuery, setActiveSearchQuery] = useState<string>('');

  const [messages, setMessages] = useState<EmailMessageSummary[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>(undefined);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [isLoading, setIsLoading] = useState(false);
  const [isConnectingGmail, setIsConnectingGmail] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [confirmTrashIds, setConfirmTrashIds] = useState<string[] | null>(null);
  const [reviewUnsubMsg, setReviewUnsubMsg] = useState<EmailMessageSummary | null>(null);

  const activeAccount =
    accounts.find((a) => a.id === selectedAccountId) || accounts[0] || null;

  useEffect(() => {
    if (accounts.length > 0 && !accounts.some((a) => a.id === selectedAccountId)) {
      setSelectedAccountId(accounts[0].id);
    } else if (accounts.length === 0) {
      setSelectedAccountId('');
      setMessages([]);
    }
  }, [accounts, selectedAccountId]);

  useEffect(() => {
    if (activeAccount) {
      void loadMessages(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccount?.id, activeView, readFilter, olderThanDays, customBeforeDate, activeSearchQuery]);

  const handleConnectGmail = async (loginHint?: string) => {
    setIsConnectingGmail(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const acct = await connectGmailAccount(loginHint);
      onAccountsChanged();
      setSelectedAccountId(acct.id);
      setStatusMsg(`Connected Gmail account ${acct.email} via official Google OAuth.`);
    } catch (err) {
      setErrorMsg((err as Error)?.message || 'Google OAuth sign-in did not complete.');
    } finally {
      setIsConnectingGmail(false);
    }
  };

  const handleDisconnect = async (id: string) => {
    await disconnectEmailAccount(id);
    onAccountsChanged();
    setSelectedIds(new Set());
    setStatusMsg('Gmail account disconnected and in-memory OAuth session cleared.');
  };

  const loadMessages = async (append: boolean) => {
    if (!activeAccount) return;
    setIsLoading(true);
    setErrorMsg(null);
    if (!append) setSelectedIds(new Set());
    try {
      const res = await fetchProviderEmails({
        account: activeAccount,
        view: activeView,
        readFilter: activeView === 'inbox' ? readFilter : undefined,
        olderThanDays: activeView === 'old_emails' && !customBeforeDate ? olderThanDays : undefined,
        customBeforeDate: activeView === 'old_emails' && customBeforeDate ? customBeforeDate : undefined,
        searchQuery: activeSearchQuery,
        pageToken: append ? nextPageToken : undefined,
        maxResults: 20,
      });
      setMessages((prev) => (append ? [...prev, ...res.messages] : res.messages));
      setNextPageToken(res.nextPageToken);
    } catch (err) {
      setErrorMsg((err as Error)?.message || 'Could not load Gmail messages.');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleSelectMessage = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (messages.length === 0) return;
    if (selectedIds.size === messages.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(messages.map((m) => m.id)));
    }
  };

  const runBulkAction = async (action: EmailBulkAction, explicitIds?: string[]) => {
    if (!activeAccount) return;
    const targetIds = explicitIds || Array.from(selectedIds);
    if (targetIds.length === 0) return;

    if (action === 'trash' && !explicitIds) {
      setConfirmTrashIds(targetIds);
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await performBulkEmailAction({
        account: activeAccount,
        messageIds: targetIds,
        action,
      });
      setSelectedIds(new Set());
      if (action === 'trash' || action === 'archive') {
        const removedSet = new Set(targetIds);
        setMessages((prev) => prev.filter((m) => !removedSet.has(m.id)));
      } else {
        const updatedSet = new Set(targetIds);
        setMessages((prev) =>
          prev.map((m) =>
            updatedSet.has(m.id) ? { ...m, isUnread: action === 'mark_unread' } : m
          )
        );
      }
      const actionLabel =
        action === 'trash'
          ? 'moved to Trash'
          : action === 'archive'
            ? 'archived'
            : action === 'mark_read'
              ? 'marked read'
              : 'marked unread';
      setStatusMsg(`${res.succeeded} email(s) ${actionLabel}.`);
    } catch (err) {
      setErrorMsg((err as Error)?.message || 'Gmail action failed.');
    } finally {
      setIsLoading(false);
    }
  };

  const tokenValid = activeAccount ? isAccountTokenValid(activeAccount) : false;

  return (
    <div className="space-y-4">
      {/* A. Connect Gmail Account Panel */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="space-y-1">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">
            Gmail Manager
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Connect one or more Gmail accounts using official Google OAuth — Mo Vibe never asks for passwords and keeps OAuth tokens strictly in memory.
          </p>
        </div>

        {/* Official Google Sign-In Button */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={isConnectingGmail}
            onClick={() => void handleConnectGmail()}
            className="h-10 px-4 rounded-xl bg-white dark:bg-[#131314] text-[#1F1F1F] dark:text-[#E3E3E3] border border-[#747775] dark:border-[#8E918F] hover:shadow-md transition-all flex items-center gap-2.5 text-sm font-medium cursor-pointer disabled:opacity-60"
          >
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M23.745 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-8.97z" />
              <path fill="#34A853" d="M12 24c3.3 0 6.08-1.09 8.1-2.96l-3.88-3.05c-1.1.74-2.51 1.18-4.22 1.18-3.24 0-5.99-2.19-6.97-5.13H1.03v3.14C3.05 21.19 7.21 24 12 24z" />
              <path fill="#FBBC05" d="M5.03 14.04c-.25-.74-.39-1.54-.39-2.36s.14-1.62.39-2.36V6.18H1.03C.37 7.5 0 8.99 0 10.68s.37 3.18 1.03 4.5l4-3.14z" />
              <path fill="#EA4335" d="M12 4.75c1.8 0 3.41.62 4.68 1.84l3.51-3.51C18.07 1.19 15.3 0 12 0 7.21 0 3.05 2.81 1.03 6.18l4 3.14c.98-2.94 3.73-5.13 6.97-5.13z" />
            </svg>
            <span>
              {isConnectingGmail
                ? 'Connecting Gmail...'
                : accounts.length > 0
                  ? 'Add Another Gmail Account'
                  : 'Sign in with Google'}
            </span>
          </button>
        </div>

        {/* Connected Gmail Accounts List */}
        {accounts.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {accounts.map((acct) => {
              const isSelected = activeAccount?.id === acct.id;
              return (
                <div
                  key={acct.id}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs ${
                    isSelected
                      ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-700 dark:text-emerald-300'
                      : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedAccountId(acct.id)}
                    className="font-semibold cursor-pointer text-left"
                  >
                    <span className="uppercase text-[10px] font-mono mr-1.5 opacity-75">
                      GMAIL
                    </span>
                    {acct.email}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDisconnect(acct.id)}
                    title="Disconnect Gmail account"
                    className="p-1 rounded-lg hover:bg-rose-500/15 text-slate-400 hover:text-rose-500 cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Status / Error */}
      {errorMsg && (
        <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1">{errorMsg}</span>
        </div>
      )}
      {statusMsg && (
        <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1">{statusMsg}</span>
        </div>
      )}

      {/* Email Workspace when connected */}
      {activeAccount && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 space-y-4">
          {!tokenValid && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs flex items-center justify-between gap-2">
              <span>OAuth access token expired for {activeAccount.email}.</span>
              <button
                type="button"
                onClick={() => void handleConnectGmail(activeAccount.email)}
                className="px-3 py-1.5 rounded-lg bg-amber-600 text-white font-semibold cursor-pointer"
              >
                Re-authenticate
              </button>
            </div>
          )}

          {/* Email Views */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {VIEW_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveView(t.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer border ${
                  activeView === t.id
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800'
                }`}
              >
                {t.icon}
                <span>{t.label}</span>
              </button>
            ))}
          </div>

          {/* J. Email Search + B. Read/Unread + E. Old Date Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setActiveSearchQuery(searchInput);
              }}
              className="flex-1 min-w-[200px] flex items-center gap-2"
            >
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search sender, subject, keyword, has:attachment..."
                  className="w-full pl-8 pr-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs text-slate-900 dark:text-slate-100"
                />
              </div>
              <button
                type="submit"
                className="px-3 py-2 rounded-xl bg-slate-900 dark:bg-slate-800 text-white text-xs font-semibold cursor-pointer"
              >
                Search
              </button>
            </form>

            {activeView === 'inbox' && (
              <select
                value={readFilter}
                onChange={(e) => setReadFilter(e.target.value as 'all' | 'unread' | 'read')}
                className="px-2.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs font-semibold"
              >
                <option value="all">All Mail</option>
                <option value="unread">Unread Only</option>
                <option value="read">Read Only</option>
              </select>
            )}

            {activeView === 'old_emails' && (
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={customBeforeDate ? 'custom' : String(olderThanDays)}
                  onChange={(e) => {
                    if (e.target.value === 'custom') {
                      const d = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
                      setCustomBeforeDate(d);
                    } else {
                      setCustomBeforeDate('');
                      setOlderThanDays(Number(e.target.value));
                    }
                  }}
                  className="px-2.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs font-semibold"
                >
                  <option value="90">Older than 3 months</option>
                  <option value="180">Older than 6 months</option>
                  <option value="365">Older than 1 year</option>
                  <option value="custom">Custom before date...</option>
                </select>
                {customBeforeDate && (
                  <input
                    type="date"
                    value={customBeforeDate}
                    onChange={(e) => setCustomBeforeDate(e.target.value)}
                    className="px-2.5 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
                  />
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => void loadMessages(false)}
              disabled={isLoading}
              className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 cursor-pointer"
              title="Refresh messages"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* C. Bulk Cleaner Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={toggleSelectAll}
              className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
            >
              {messages.length > 0 && selectedIds.size === messages.length ? (
                <CheckSquare className="w-4 h-4 text-emerald-600" />
              ) : (
                <Square className="w-4 h-4 text-slate-400" />
              )}
              <span>
                {selectedIds.size > 0 ? `${selectedIds.size} selected` : 'Select All'}
              </span>
            </button>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                disabled={selectedIds.size === 0 || isLoading}
                onClick={() => void runBulkAction('archive')}
                className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] font-semibold flex items-center gap-1 disabled:opacity-40 cursor-pointer"
              >
                <Archive className="w-3 h-3" />
                <span>Archive</span>
              </button>
              <button
                type="button"
                disabled={selectedIds.size === 0 || isLoading}
                onClick={() => void runBulkAction('mark_read')}
                className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] font-semibold disabled:opacity-40 cursor-pointer"
              >
                Mark Read
              </button>
              <button
                type="button"
                disabled={selectedIds.size === 0 || isLoading}
                onClick={() => void runBulkAction('mark_unread')}
                className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-[11px] font-semibold disabled:opacity-40 cursor-pointer"
              >
                Mark Unread
              </button>
              <button
                type="button"
                disabled={selectedIds.size === 0 || isLoading}
                onClick={() => void runBulkAction('trash')}
                className="px-2.5 py-1.5 rounded-lg bg-rose-600 text-white text-[11px] font-semibold flex items-center gap-1 disabled:opacity-40 cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
                <span>Move to Trash</span>
              </button>
            </div>
          </div>

          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            <strong>Archive</strong> keeps emails in All Mail out of your Inbox.{' '}
            <strong>Move to Trash</strong> moves selected messages to Trash (recoverable for 30 days). Mo Vibe never permanently bypasses Trash without explicit action inside Gmail.
          </p>

          {/* Messages List */}
          {isLoading && messages.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
              <span>Loading real Gmail messages...</span>
            </div>
          ) : messages.length === 0 ? (
            <div className="p-8 text-center rounded-xl bg-slate-50 dark:bg-slate-950/50 text-xs text-slate-500 dark:text-slate-400">
              No messages matched this folder or filter.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {messages.map((msg) => {
                const checked = selectedIds.has(msg.id);
                return (
                  <div
                    key={msg.id}
                    className={`py-3 flex items-start gap-3 ${
                      msg.isUnread ? 'bg-emerald-500/[0.03]' : ''
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSelectMessage(msg.id)}
                      className="mt-0.5 cursor-pointer shrink-0"
                      aria-label="Select message"
                    >
                      {checked ? (
                        <CheckSquare className="w-4 h-4 text-emerald-600" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-400" />
                      )}
                    </button>

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <p
                          className={`text-xs truncate ${
                            msg.isUnread
                              ? 'font-bold text-slate-900 dark:text-white'
                              : 'font-semibold text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {msg.from}
                        </p>
                        <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 shrink-0">
                          {msg.dateFormatted}
                        </span>
                      </div>
                      <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {msg.subject}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-1">
                        {msg.snippet}
                      </p>

                      <div className="flex flex-wrap items-center gap-2 pt-0.5">
                        {msg.isUnread && (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold">
                            Unread
                          </span>
                        )}
                        {msg.hasAttachments && (
                          <span className="px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-700 dark:text-blue-300 text-[10px] font-semibold flex items-center gap-1">
                            <Paperclip className="w-2.5 h-2.5" />
                            {msg.attachmentBytes > 0
                              ? formatBytes(msg.attachmentBytes)
                              : `${msg.attachmentNames.length || 1} attachment(s)`}
                          </span>
                        )}
                        {(msg.unsubscribeUrl || msg.unsubscribeMailto) && (
                          <button
                            type="button"
                            onClick={() => setReviewUnsubMsg(msg)}
                            className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[10px] font-bold cursor-pointer hover:bg-amber-500/25"
                          >
                            Review Unsubscribe
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {nextPageToken && (
            <div className="pt-2 text-center">
              <button
                type="button"
                disabled={isLoading}
                onClick={() => void loadMessages(true)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-100 cursor-pointer"
              >
                {isLoading ? 'Loading...' : 'Load More Messages'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Bulk Move to Trash Confirmation Modal */}
      {confirmTrashIds && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 shadow-2xl">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white">
              Move {confirmTrashIds.length} Email(s) to Trash?
            </h4>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              Selected emails will be moved to Gmail Trash (not immediately purged). You can recover them in Gmail for up to 30 days.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmTrashIds(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const ids = confirmTrashIds;
                  setConfirmTrashIds(null);
                  void runBulkAction('trash', ids);
                }}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold cursor-pointer"
              >
                Move to Trash
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Review Before Unsubscribing Modal (Never Auto-Unsubscribes) */}
      {reviewUnsubMsg && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-4 shadow-2xl">
            <h4 className="text-sm font-bold text-slate-900 dark:text-white">
              Review Unsubscribe Request
            </h4>
            <div className="text-xs space-y-1.5 text-slate-600 dark:text-slate-300">
              <p>
                <strong>Sender:</strong> {reviewUnsubMsg.from}
              </p>
              <p>
                <strong>Subject:</strong> {reviewUnsubMsg.subject}
              </p>
              {reviewUnsubMsg.unsubscribeUrl && (
                <p className="break-all">
                  <strong>Unsubscribe URL:</strong> {reviewUnsubMsg.unsubscribeUrl}
                </p>
              )}
              {reviewUnsubMsg.unsubscribeMailto && (
                <p className="break-all">
                  <strong>Unsubscribe Email:</strong> {reviewUnsubMsg.unsubscribeMailto}
                </p>
              )}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Mo Vibe never unsubscribes automatically. Verify the sender above before opening their official unsubscribe link.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReviewUnsubMsg(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <a
                href={reviewUnsubMsg.unsubscribeUrl || reviewUnsubMsg.unsubscribeMailto || '#'}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setReviewUnsubMsg(null)}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5"
              >
                <span>Open Unsubscribe</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
