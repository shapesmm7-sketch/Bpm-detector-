import { isNativeAndroid } from '../plugins/audioLibrary';
import { GmailAuth } from '../plugins/gmailAuth';
import oauthClientConfig from '../../firebase-applet-config.json';

export type EmailProviderId = 'gmail';

export interface ConnectedEmailAccount {
  id: string;
  provider: EmailProviderId;
  email: string;
  displayName: string;
  accessToken: string;
  expiresAt: number;
  scopes: string[];
}

export interface EmailMessageSummary {
  id: string;
  threadId?: string;
  accountId: string;
  provider: EmailProviderId;
  from: string;
  subject: string;
  snippet: string;
  dateMs: number;
  dateFormatted: string;
  isUnread: boolean;
  isPromotional: boolean;
  isSpam: boolean;
  isTrash: boolean;
  hasAttachments: boolean;
  attachmentBytes: number;
  sizeEstimate?: number;
  attachmentNames: string[];
  unsubscribeMailto?: string;
  unsubscribeUrl?: string;
  hasOneClickUnsubscribe?: boolean;
  labels: string[];
}

export type EmailFilterView =
  | 'inbox'
  | 'unread'
  | 'promotions'
  | 'spam'
  | 'large_attachments'
  | 'old_emails'
  | 'unsubscribe';

export type EmailBulkAction =
  | 'archive'
  | 'mark_read'
  | 'mark_unread'
  | 'trash';

// Strict in-memory token & message cache store (NEVER persisted to localStorage or sessionStorage)
const connectedAccountsMap = new Map<string, ConnectedEmailAccount>();
// Non-secret account directory (email & displayName ONLY — never tokens or email content)
const SAVED_GMAIL_PROFILES_KEY = 'movibe_saved_gmail_accounts_v1';

interface SavedGmailAccountProfile {
  id: string;
  provider: EmailProviderId;
  email: string;
  displayName: string;
  scopes: string[];
}

function readSavedGmailProfiles(): SavedGmailAccountProfile[] {
  try {
    const raw = localStorage.getItem(SAVED_GMAIL_PROFILES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SavedGmailAccountProfile =>
        Boolean(item && typeof item.email === 'string' && item.email.includes('@'))
    );
  } catch {
    return [];
  }
}

function writeSavedGmailProfiles(list: SavedGmailAccountProfile[]): void {
  try {
    localStorage.setItem(SAVED_GMAIL_PROFILES_KEY, JSON.stringify(list));
  } catch {
    // ignore storage errors
  }
}

function rememberGmailProfile(account: Pick<ConnectedEmailAccount, 'id' | 'provider' | 'email' | 'displayName' | 'scopes'>): void {
  const normalizedEmail = account.email.trim().toLowerCase();
  const nextEntry: SavedGmailAccountProfile = {
    id: `gmail:${normalizedEmail}`,
    provider: 'gmail',
    email: account.email.trim(),
    displayName: account.displayName || account.email.trim(),
    scopes: account.scopes?.length ? account.scopes : GMAIL_OAUTH_SCOPES,
  };
  const existing = readSavedGmailProfiles().filter(
    (p) => p.email.trim().toLowerCase() !== normalizedEmail
  );
  writeSavedGmailProfiles([nextEntry, ...existing]);
}

function forgetGmailProfile(accountIdOrEmail: string): void {
  const target = accountIdOrEmail.trim().toLowerCase();
  const next = readSavedGmailProfiles().filter(
    (p) => p.id.toLowerCase() !== target && p.email.trim().toLowerCase() !== target
  );
  writeSavedGmailProfiles(next);
}

const accountsListeners = new Set<() => void>();

function notifyAccountsChanged(): void {
  for (const fn of accountsListeners) {
    try {
      fn();
    } catch {
      // ignore subscriber errors
    }
  }
}

export function subscribeConnectedAccounts(fn: () => void): () => void {
  accountsListeners.add(fn);
  return () => {
    accountsListeners.delete(fn);
  };
}

export interface EmailAccountCacheSnapshot {
  accountId: string;
  ready: boolean;
  isSyncing: boolean;
  syncedAt: number;
  loadedCount: number;
  totalMatchedCount: number | null;
  error: string | null;
  messages: EmailMessageSummary[];
}

const EMPTY_CACHE_SNAPSHOT = (accountId: string): EmailAccountCacheSnapshot => ({
  accountId,
  ready: false,
  isSyncing: false,
  syncedAt: 0,
  loadedCount: 0,
  totalMatchedCount: null,
  error: null,
  messages: [],
});

const emailCacheMap = new Map<string, EmailAccountCacheSnapshot>();
const inflightEmailSyncMap = new Map<
  string,
  { promise: Promise<EmailAccountCacheSnapshot>; controller: AbortController }
>();
const emailCacheListeners = new Set<() => void>();

function notifyEmailCacheListeners(): void {
  for (const fn of emailCacheListeners) {
    try {
      fn();
    } catch {
      // ignore subscriber errors
    }
  }
}

export function subscribeEmailCache(fn: () => void): () => void {
  emailCacheListeners.add(fn);
  return () => {
    emailCacheListeners.delete(fn);
  };
}

export function getEmailCacheSnapshot(accountId: string): EmailAccountCacheSnapshot {
  if (!accountId) return EMPTY_CACHE_SNAPSHOT('');
  return emailCacheMap.get(accountId) || EMPTY_CACHE_SNAPSHOT(accountId);
}

export const GMAIL_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/userinfo.email',
];

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
  scope?: string;
}

interface GoogleTokenClient {
  requestAccessToken: (overrideConfig?: {
    prompt?: string;
    login_hint?: string;
  }) => void;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (resp: GoogleTokenResponse) => void;
            error_callback?: (err: { type?: string; message?: string }) => void;
          }) => GoogleTokenClient;
          revoke?: (token: string, done?: () => void) => void;
        };
      };
    };
  }
}

let gisLoadPromise: Promise<void> | null = null;

function ensureGoogleIdentityScript(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Identity Services requires a browser window.'));
  }
  if (window.google?.accounts?.oauth2?.initTokenClient) {
    return Promise.resolve();
  }
  if (gisLoadPromise) return gisLoadPromise;

  gisLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://accounts.google.com/gsi/client"]'
    );
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener(
        'error',
        () => reject(new Error('Could not load Google Identity Services script.')),
        { once: true }
      );
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      gisLoadPromise = null;
      reject(new Error('Could not load Google Identity Services script. Check your network connection.'));
    };
    document.head.appendChild(script);
  });

  return gisLoadPromise;
}

async function fetchGoogleUserProfile(
  accessToken: string,
  fallbackEmail?: string
): Promise<{ email: string; displayName: string }> {
  try {
    const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (resp.ok) {
      const info = (await resp.json()) as {
        email?: string;
        name?: string;
      };
      if (info.email) {
        return {
          email: info.email,
          displayName: info.name || info.email,
        };
      }
    }
  } catch {
    // fallback below
  }

  // Fallback to Gmail profile endpoint using the Gmail token
  const gmResp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (gmResp.ok) {
    const gm = (await gmResp.json()) as { emailAddress?: string };
    if (gm.emailAddress) {
      return { email: gm.emailAddress, displayName: gm.emailAddress };
    }
  }

  const email = fallbackEmail || 'Gmail Account';
  return { email, displayName: email };
}

export function getConnectedEmailAccounts(): ConnectedEmailAccount[] {
  return Array.from(connectedAccountsMap.values());
}

export function getConnectedEmailAccount(accountId: string): ConnectedEmailAccount | undefined {
  return connectedAccountsMap.get(accountId);
}

export function isAccountTokenValid(account: ConnectedEmailAccount): boolean {
  return Boolean(account.accessToken) && Date.now() < account.expiresAt - 60_000;
}

export async function disconnectEmailAccount(accountId: string): Promise<void> {
  const acct = connectedAccountsMap.get(accountId);
  connectedAccountsMap.delete(accountId);
  forgetGmailProfile(acct?.email || accountId);

  const inflight = inflightEmailSyncMap.get(accountId);
  if (inflight) {
    inflight.controller.abort();
    inflightEmailSyncMap.delete(accountId);
  }
  emailCacheMap.delete(accountId);
  notifyEmailCacheListeners();
  notifyAccountsChanged();

  if (isNativeAndroid()) {
    const emailToClear = acct?.email || (accountId.startsWith('gmail:') ? accountId.slice(6) : '');
    if (emailToClear) {
      try {
        await GmailAuth.removeSavedAccount({ email: emailToClear });
      } catch {
        // ignore native remove failure
      }
    }
    if (acct?.accessToken) {
      try {
        await GmailAuth.clearCachedToken({ token: acct.accessToken, email: emailToClear });
      } catch {
        // ignore token clear failure
      }
    }
    return;
  }

  if (!acct?.accessToken) return;

  try {
    window.google?.accounts?.oauth2?.revoke?.(acct.accessToken);
  } catch {
    // ignore revoke errors
  }
}

/**
 * Authorizes Gmail directly inside the app without Firebase Auth or opening external links:
 * - Native Android: uses Google Play Services Identity AuthorizationClient + Android AccountManager
 * - Web / Browser: uses Google Identity Services (GIS) Token Client
 * Access tokens remain strictly in memory with expiration tracking.
 */
export async function connectGmailAccount(loginHint?: string): Promise<ConnectedEmailAccount> {
  let accessToken = '';
  let expiresInSec = 3300;
  let initialEmailHint = loginHint;

  if (isNativeAndroid()) {
    const nativeRes = await GmailAuth.authorizeGmail({
      scopes: GMAIL_OAUTH_SCOPES,
      loginHint,
    });
    accessToken = nativeRes.accessToken;
    initialEmailHint = nativeRes.email || loginHint;
  } else {
    await ensureGoogleIdentityScript();
    const oauth2 = window.google?.accounts?.oauth2;
    if (!oauth2?.initTokenClient) {
      throw new Error('Google Identity Services could not initialize.');
    }

    const tokenResp = await new Promise<GoogleTokenResponse>((resolve, reject) => {
      const client = oauth2.initTokenClient({
        client_id: oauthClientConfig.oAuthClientId,
        scope: GMAIL_OAUTH_SCOPES.join(' '),
        callback: (resp) => {
          if (resp.error || !resp.access_token) {
            reject(
              new Error(
                resp.error_description || resp.error || 'Google Sign-In did not return an access token.'
              )
            );
            return;
          }
          resolve(resp);
        },
        error_callback: (err) => {
          reject(new Error(err.message || err.type || 'Google Sign-In cancelled or closed.'));
        },
      });

      client.requestAccessToken({
        prompt: loginHint ? 'consent' : 'select_account',
        ...(loginHint ? { login_hint: loginHint } : {}),
      });
    });

    accessToken = tokenResp.access_token || '';
    if (tokenResp.expires_in && tokenResp.expires_in > 60) {
      expiresInSec = tokenResp.expires_in - 120;
    }
  }

  if (!accessToken) {
    throw new Error('Could not obtain Gmail access token.');
  }

  const profile = await fetchGoogleUserProfile(accessToken, initialEmailHint);
  const accountId = `gmail:${profile.email.toLowerCase()}`;

  const account: ConnectedEmailAccount = {
    id: accountId,
    provider: 'gmail',
    email: profile.email,
    displayName: profile.displayName,
    accessToken,
    expiresAt: Date.now() + expiresInSec * 1000,
    scopes: GMAIL_OAUTH_SCOPES,
  };

  connectedAccountsMap.set(accountId, account);
  rememberGmailProfile(account);
  notifyAccountsChanged();
  // Immediately start downloading & saving all mailbox messages once right after connect
  void syncGmailAccountCache(account, true);
  return account;
}

let restoreAccountsPromise: Promise<void> | null = null;

/**
 * Restores previously connected Gmail accounts when Mo Vibe opens:
 * - Native Android: silently obtains fresh OAuth access tokens via Google Play Services
 *   for remembered accounts (zero login prompts) and pre-loads mailbox messages into memory.
 * - Web / Browser: restores remembered account entries so the user stays listed with 1-tap reconnect.
 */
export async function restoreSavedGmailAccounts(): Promise<void> {
  if (restoreAccountsPromise) return restoreAccountsPromise;

  restoreAccountsPromise = (async () => {
    try {
      const savedProfiles = readSavedGmailProfiles();
      const profileByLowerEmail = new Map<string, SavedGmailAccountProfile>();
      for (const p of savedProfiles) {
        profileByLowerEmail.set(p.email.trim().toLowerCase(), p);
      }

      if (isNativeAndroid()) {
        try {
          const nativeSaved = await GmailAuth.getSavedAccounts();
          for (const email of nativeSaved.emails || []) {
            const normalized = email.trim().toLowerCase();
            if (normalized && !profileByLowerEmail.has(normalized)) {
              profileByLowerEmail.set(normalized, {
                id: `gmail:${normalized}`,
                provider: 'gmail',
                email: email.trim(),
                displayName: email.trim(),
                scopes: GMAIL_OAUTH_SCOPES,
              });
            }
          }
        } catch {
          // ignore native read failure
        }
      }

      const combined = Array.from(profileByLowerEmail.values());
      if (combined.length === 0) return;

      for (const prof of combined) {
        if (!connectedAccountsMap.has(prof.id)) {
          connectedAccountsMap.set(prof.id, {
            id: prof.id,
            provider: 'gmail',
            email: prof.email,
            displayName: prof.displayName,
            accessToken: '',
            expiresAt: 0,
            scopes: prof.scopes?.length ? prof.scopes : GMAIL_OAUTH_SCOPES,
          });
        }
      }
      notifyAccountsChanged();

      if (!isNativeAndroid()) {
        return;
      }

      for (const prof of combined) {
        const existing = connectedAccountsMap.get(prof.id);
        if (existing && isAccountTokenValid(existing)) continue;
        try {
          const silentRes = await GmailAuth.authorizeSilent({
            email: prof.email,
            scopes: GMAIL_OAUTH_SCOPES,
          });
          if (!silentRes.needsReauth && silentRes.accessToken) {
            const refreshedProfile = await fetchGoogleUserProfile(silentRes.accessToken, prof.email);
            const restored: ConnectedEmailAccount = {
              id: prof.id,
              provider: 'gmail',
              email: refreshedProfile.email || prof.email,
              displayName: refreshedProfile.displayName || prof.displayName || prof.email,
              accessToken: silentRes.accessToken,
              expiresAt: Date.now() + 3300 * 1000,
              scopes:
                silentRes.grantedScopes && silentRes.grantedScopes.length > 0
                  ? silentRes.grantedScopes
                  : GMAIL_OAUTH_SCOPES,
            };
            connectedAccountsMap.set(prof.id, restored);
            rememberGmailProfile(restored);
            notifyAccountsChanged();
            void syncGmailAccountCache(restored, false);
          }
        } catch {
          // Keep account entry intact with reconnect button if silent Play Services auth is unavailable
        }
      }
    } finally {
      restoreAccountsPromise = null;
    }
  })();

  return restoreAccountsPromise;
}

export interface FetchEmailsOptions {
  account: ConnectedEmailAccount;
  view: EmailFilterView;
  searchQuery?: string;
  readFilter?: 'all' | 'unread' | 'read';
  olderThanDays?: number;
  customBeforeDate?: string; // YYYY-MM-DD
  signal?: AbortSignal;
  onProgress?: (messages: EmailMessageSummary[], totalMatchedIds: number) => void;
}

export interface FetchEmailsResult {
  messages: EmailMessageSummary[];
  totalMatchedIds: number;
}

/**
 * Fetches ALL non-Trash Gmail messages (Inbox, Promotions, Spam, Archived, Unsubscribe,
 * Attachments) once per connected account and caches them in memory so opening or
 * switching any Email Manager folder is instantaneous.
 */
export async function syncGmailAccountCache(
  account: ConnectedEmailAccount,
  forceRefresh = false
): Promise<EmailAccountCacheSnapshot> {
  const existing = emailCacheMap.get(account.id);
  if (!forceRefresh && existing?.ready) {
    return existing;
  }

  const existingInflight = inflightEmailSyncMap.get(account.id);
  if (existingInflight) {
    if (!forceRefresh) {
      return existingInflight.promise;
    }
    existingInflight.controller.abort();
    inflightEmailSyncMap.delete(account.id);
  }

  if (!isAccountTokenValid(account)) {
    if (isNativeAndroid()) {
      try {
        const silentRes = await GmailAuth.authorizeSilent({
          email: account.email,
          scopes: GMAIL_OAUTH_SCOPES,
        });
        if (!silentRes.needsReauth && silentRes.accessToken) {
          account = {
            ...account,
            accessToken: silentRes.accessToken,
            expiresAt: Date.now() + 3300 * 1000,
          };
          connectedAccountsMap.set(account.id, account);
          notifyAccountsChanged();
        }
      } catch {
        // fall through to expired state below
      }
    }
  }

  if (!isAccountTokenValid(account)) {
    const expiredSnap: EmailAccountCacheSnapshot = {
      accountId: account.id,
      ready: Boolean(existing?.ready),
      isSyncing: false,
      syncedAt: existing?.syncedAt || 0,
      loadedCount: existing?.loadedCount || 0,
      totalMatchedCount: existing?.totalMatchedCount ?? null,
      error: `Session expired for ${account.email}. Tap "Re-authenticate" to refresh Gmail access.`,
      messages: existing?.messages || [],
    };
    emailCacheMap.set(account.id, expiredSnap);
    notifyEmailCacheListeners();
    return expiredSnap;
  }

  const controller = new AbortController();
  const initialSnap: EmailAccountCacheSnapshot = {
    accountId: account.id,
    ready: Boolean(existing?.ready && !forceRefresh),
    isSyncing: true,
    syncedAt: existing?.syncedAt || 0,
    loadedCount: 0,
    totalMatchedCount: null,
    error: null,
    messages: existing?.messages || [],
  };
  emailCacheMap.set(account.id, initialSnap);
  notifyEmailCacheListeners();

  const promise = (async (): Promise<EmailAccountCacheSnapshot> => {
    try {
      const allRefs: Array<{ id: string }> = [];
      let pageToken: string | undefined;

      do {
        if (controller.signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
        listUrl.searchParams.set('maxResults', '500');
        listUrl.searchParams.set('q', '-in:trash');
        listUrl.searchParams.set('includeSpamTrash', 'true');
        if (pageToken) listUrl.searchParams.set('pageToken', pageToken);

        const listResp = await fetch(listUrl.toString(), {
          headers: { Authorization: `Bearer ${account.accessToken}` },
          signal: controller.signal,
        });
        if (!listResp.ok) {
          const txt = await listResp.text();
          throw new Error(formatGmailApiError(listResp.status, txt, 'Gmail API error'));
        }
        const listData = (await listResp.json()) as {
          messages?: Array<{ id: string }>;
          nextPageToken?: string;
        };

        if (listData.messages && listData.messages.length > 0) {
          allRefs.push(...listData.messages);
        }
        pageToken = listData.nextPageToken;
      } while (pageToken);

      emailCacheMap.set(account.id, {
        ...(emailCacheMap.get(account.id) || initialSnap),
        totalMatchedCount: allRefs.length,
      });
      notifyEmailCacheListeners();

      const BATCH_SIZE = 25;
      const collected: EmailMessageSummary[] = [];

      for (let i = 0; i < allRefs.length; i += BATCH_SIZE) {
        if (controller.signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        const slice = allRefs.slice(i, i + BATCH_SIZE);
        const details = await Promise.all(
          slice.map((ref) =>
            fetchGmailMessageDetail(ref.id, account.accessToken, account.id, controller.signal)
          )
        );
        for (const item of details) {
          if (item && !item.isTrash) {
            collected.push(item);
          }
        }
        const ordered = [...collected].sort((a, b) => b.dateMs - a.dateMs);
        emailCacheMap.set(account.id, {
          accountId: account.id,
          ready: false,
          isSyncing: true,
          syncedAt: Date.now(),
          loadedCount: ordered.length,
          totalMatchedCount: allRefs.length,
          error: null,
          messages: ordered,
        });
        notifyEmailCacheListeners();
      }

      const finalOrdered = [...collected].sort((a, b) => b.dateMs - a.dateMs);
      const doneSnap: EmailAccountCacheSnapshot = {
        accountId: account.id,
        ready: true,
        isSyncing: false,
        syncedAt: Date.now(),
        loadedCount: finalOrdered.length,
        totalMatchedCount: allRefs.length,
        error: null,
        messages: finalOrdered,
      };
      emailCacheMap.set(account.id, doneSnap);
      notifyEmailCacheListeners();
      return doneSnap;
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        return emailCacheMap.get(account.id) || initialSnap;
      }
      const errSnap: EmailAccountCacheSnapshot = {
        ...(emailCacheMap.get(account.id) || initialSnap),
        isSyncing: false,
        error: (err as Error)?.message || 'Could not sync Gmail messages.',
      };
      emailCacheMap.set(account.id, errSnap);
      notifyEmailCacheListeners();
      return errSnap;
    } finally {
      const current = inflightEmailSyncMap.get(account.id);
      if (current?.promise === promise) {
        inflightEmailSyncMap.delete(account.id);
      }
    }
  })();

  inflightEmailSyncMap.set(account.id, { promise, controller });
  return promise;
}

export function filterCachedEmails(
  allMessages: EmailMessageSummary[],
  opts: {
    view: EmailFilterView;
    readFilter?: 'all' | 'unread' | 'read';
    olderThanDays?: number;
    customBeforeDate?: string;
    searchQuery?: string;
  }
): EmailMessageSummary[] {
  let list = allMessages.filter((m) => {
    if (m.isTrash) return false;
    if (opts.view === 'spam') {
      return m.isSpam;
    }
    if (m.isSpam) return false;

    if (opts.view === 'inbox') {
      if (!m.labels.includes('INBOX')) return false;
      if (opts.readFilter === 'unread' && !m.isUnread) return false;
      if (opts.readFilter === 'read' && m.isUnread) return false;
      return true;
    }
    if (opts.view === 'unread') {
      return m.labels.includes('INBOX') && m.isUnread;
    }
    if (opts.view === 'promotions') {
      return m.labels.includes('CATEGORY_PROMOTIONS');
    }
    if (opts.view === 'large_attachments') {
      return (
        m.hasAttachments &&
        (m.attachmentBytes >= 1_000_000 || (m.sizeEstimate || 0) >= 1_000_000)
      );
    }
    if (opts.view === 'unsubscribe') {
      return Boolean(m.unsubscribeUrl || m.unsubscribeMailto);
    }
    if (opts.view === 'old_emails') {
      let cutoffMs = 0;
      if (opts.customBeforeDate) {
        const parsed = Date.parse(`${opts.customBeforeDate}T00:00:00`);
        if (Number.isFinite(parsed)) cutoffMs = parsed;
      } else if (opts.olderThanDays && opts.olderThanDays > 0) {
        cutoffMs = Date.now() - opts.olderThanDays * 24 * 60 * 60 * 1000;
      }
      if (cutoffMs > 0 && m.dateMs >= cutoffMs) return false;
      return true;
    }
    return true;
  });

  const q = (opts.searchQuery || '').trim();
  if (q) {
    const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    list = list.filter((m) => {
      const fromL = m.from.toLowerCase();
      const subjL = m.subject.toLowerCase();
      const snipL = m.snippet.toLowerCase();
      const attL = m.attachmentNames.join(' ').toLowerCase();
      const combined = `${fromL} ${subjL} ${snipL} ${attL}`;

      return tokens.every((tok) => {
        if (tok === 'has:attachment') return m.hasAttachments;
        if (tok === 'is:unread') return m.isUnread;
        if (tok === 'is:read') return !m.isUnread;
        if (tok.startsWith('from:')) {
          const val = tok.slice(5);
          return val ? fromL.includes(val) : true;
        }
        if (tok.startsWith('subject:')) {
          const val = tok.slice(8);
          return val ? subjL.includes(val) : true;
        }
        if (tok.startsWith('larger:')) {
          const num = parseFloat(tok.slice(7));
          if (!Number.isFinite(num)) return true;
          const mult = tok.endsWith('k') ? 1024 : 1024 * 1024;
          return (m.attachmentBytes || m.sizeEstimate || 0) >= num * mult;
        }
        return combined.includes(tok);
      });
    });
  }

  if (opts.view === 'large_attachments') {
    return [...list].sort(
      (a, b) =>
        (b.attachmentBytes || b.sizeEstimate || 0) -
        (a.attachmentBytes || a.sizeEstimate || 0)
    );
  }
  return list;
}

export async function fetchProviderEmails(opts: FetchEmailsOptions): Promise<FetchEmailsResult> {
  if (!isAccountTokenValid(opts.account)) {
    throw new Error(
      `Session expired for ${opts.account.email}. Tap "Re-authenticate" to refresh Gmail access.`
    );
  }
  return fetchGmailMessages(opts);
}

function buildGmailQuery(opts: FetchEmailsOptions): string {
  const parts: string[] = [];

  if (opts.view === 'spam') {
    parts.push('in:spam');
  } else if (opts.view === 'promotions') {
    parts.push('category:promotions');
  } else if (opts.view === 'unread') {
    parts.push('in:inbox is:unread');
  } else if (opts.view === 'large_attachments') {
    parts.push('has:attachment larger:1M');
  } else if (opts.view === 'old_emails') {
    parts.push('-in:spam -in:trash');
  } else if (opts.view === 'unsubscribe') {
    parts.push('-in:spam -in:trash');
  } else {
    parts.push('in:inbox');
  }

  if (opts.readFilter === 'unread' && opts.view !== 'unread') {
    parts.push('is:unread');
  } else if (opts.readFilter === 'read') {
    parts.push('is:read');
  }

  if (opts.customBeforeDate) {
    const slashDate = opts.customBeforeDate.replace(/-/g, '/');
    parts.push(`before:${slashDate}`);
  } else if (opts.olderThanDays && opts.olderThanDays > 0) {
    const cutoff = new Date(Date.now() - opts.olderThanDays * 24 * 60 * 60 * 1000);
    const y = cutoff.getFullYear();
    const m = String(cutoff.getMonth() + 1).padStart(2, '0');
    const d = String(cutoff.getDate()).padStart(2, '0');
    parts.push(`before:${y}/${m}/${d}`);
  }

  if (opts.searchQuery && opts.searchQuery.trim()) {
    parts.push(opts.searchQuery.trim());
  }

  return parts.join(' ').trim();
}

interface GmailHeader {
  name?: string;
  value?: string;
}

interface GmailPayloadPart {
  filename?: string;
  body?: { size?: number; attachmentId?: string };
  parts?: GmailPayloadPart[];
  headers?: GmailHeader[];
}

interface GmailMessageRaw {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  sizeEstimate?: number;
  payload?: GmailPayloadPart;
}

function formatGmailApiError(status: number, rawText: string, actionLabel = 'Gmail API error'): string {
  try {
    const parsed = JSON.parse(rawText) as {
      error?: {
        code?: number;
        message?: string;
        status?: string;
        errors?: Array<{ reason?: string; message?: string }>;
        details?: Array<{
          reason?: string;
          metadata?: { activationUrl?: string; consumer?: string };
        }>;
      };
    };
    const err = parsed?.error;
    const reason =
      err?.errors?.[0]?.reason ||
      err?.details?.find((d) => d.reason)?.reason ||
      '';
    const activationUrl = err?.details?.find((d) => d.metadata?.activationUrl)?.metadata
      ?.activationUrl;

    if (reason === 'accessNotConfigured' || reason === 'SERVICE_DISABLED') {
      const projectMatch =
        err?.message?.match(/project\s+(\d+)/i) ||
        activationUrl?.match(/project=(\d+)/i);
      const projectId = projectMatch ? ` (${projectMatch[1]})` : '';
      return `Gmail API is disabled in your Google Cloud project${projectId}. Enable "Gmail API" in Google Cloud Console -> APIs & Services -> Library, wait 2–5 minutes, then tap Refresh.${activationUrl ? ` Link: ${activationUrl}` : ''}`;
    }

    if (status === 401) {
      return 'Gmail OAuth session expired or was revoked. Tap "Re-authenticate" to reconnect.';
    }

    if (reason === 'insufficientPermissions' || reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT') {
      return 'Missing Gmail permissions on this sign-in session. Disconnect and sign in again, checking the Gmail access box on Google consent.';
    }

    if (err?.message) {
      return `${actionLabel} (${status}): ${err.message}`;
    }
  } catch {
    // non-JSON error body; fall through
  }
  return `${actionLabel} (${status}): ${rawText}`;
}

const GMAIL_MESSAGE_FIELDS =
  'id,threadId,labelIds,snippet,internalDate,sizeEstimate,payload(headers,filename,body/size,parts(filename,body/size,parts(filename,body/size)))';

async function fetchGmailMessageDetail(
  id: string,
  accessToken: string,
  accountId: string,
  signal?: AbortSignal
): Promise<EmailMessageSummary | null> {
  const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(
    id
  )}?format=full&fields=${encodeURIComponent(GMAIL_MESSAGE_FIELDS)}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal?.aborted) return null;
    const resp = await fetch(msgUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal,
    });
    if (resp.ok) {
      const raw = (await resp.json()) as GmailMessageRaw;
      return parseGmailMessage(raw, accountId);
    }
    if ((resp.status === 429 || resp.status === 503) && attempt === 0) {
      await new Promise((r) => setTimeout(r, 450));
      continue;
    }
    return null;
  }
  return null;
}

async function fetchGmailMessages(opts: FetchEmailsOptions): Promise<FetchEmailsResult> {
  const q = buildGmailQuery(opts);
  const allRefs: Array<{ id: string }> = [];
  let pageToken: string | undefined;

  // Step 1: Automatically gather ALL matching message IDs across every page (500/page)
  do {
    if (opts.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    listUrl.searchParams.set('maxResults', '500');
    if (q) listUrl.searchParams.set('q', q);
    if (opts.view === 'spam') listUrl.searchParams.set('includeSpamTrash', 'true');
    if (pageToken) listUrl.searchParams.set('pageToken', pageToken);

    const listResp = await fetch(listUrl.toString(), {
      headers: { Authorization: `Bearer ${opts.account.accessToken}` },
      signal: opts.signal,
    });
    if (!listResp.ok) {
      const txt = await listResp.text();
      throw new Error(formatGmailApiError(listResp.status, txt, 'Gmail API error'));
    }
    const listData = (await listResp.json()) as {
      messages?: Array<{ id: string }>;
      nextPageToken?: string;
    };

    if (listData.messages && listData.messages.length > 0) {
      allRefs.push(...listData.messages);
    }
    pageToken = listData.nextPageToken;
  } while (pageToken);

  if (allRefs.length === 0) {
    return { messages: [], totalMatchedIds: 0 };
  }

  // Step 2: Fetch message summaries in controlled batches and stream progress immediately
  const BATCH_SIZE = 25;
  const collected: EmailMessageSummary[] = [];

  for (let i = 0; i < allRefs.length; i += BATCH_SIZE) {
    if (opts.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const slice = allRefs.slice(i, i + BATCH_SIZE);
    const details = await Promise.all(
      slice.map((ref) =>
        fetchGmailMessageDetail(ref.id, opts.account.accessToken, opts.account.id, opts.signal)
      )
    );

    for (const item of details) {
      if (!item) continue;
      if (opts.view === 'unsubscribe' && !item.unsubscribeUrl && !item.unsubscribeMailto) {
        continue;
      }
      collected.push(item);
    }

    if (opts.onProgress) {
      const snapshot =
        opts.view === 'large_attachments'
          ? [...collected].sort((a, b) => b.attachmentBytes - a.attachmentBytes)
          : [...collected];
      opts.onProgress(snapshot, allRefs.length);
    }
  }

  if (opts.view === 'large_attachments') {
    collected.sort((a, b) => b.attachmentBytes - a.attachmentBytes);
  }

  return {
    messages: collected,
    totalMatchedIds: allRefs.length,
  };
}

function parseGmailMessage(raw: GmailMessageRaw, accountId: string): EmailMessageSummary {
  const headers = raw.payload?.headers || [];
  const getHeader = (target: string) =>
    headers.find((h) => (h.name || '').toLowerCase() === target)?.value || '';

  const from = getHeader('from') || 'Unknown sender';
  const subject = getHeader('subject') || '(No subject)';
  const listUnsub = getHeader('list-unsubscribe');
  const listUnsubPost = getHeader('list-unsubscribe-post');

  const unsubParsed = parseListUnsubscribeHeader(listUnsub, listUnsubPost);
  const attachments = collectGmailAttachments(raw.payload);

  const dateMs = raw.internalDate ? Number(raw.internalDate) : Date.now();
  const labels = raw.labelIds || [];
  const isUnread = labels.includes('UNREAD');
  const isSpam = labels.includes('SPAM');
  const isTrash = labels.includes('TRASH');
  const isPromotional =
    labels.includes('CATEGORY_PROMOTIONS') || Boolean(unsubParsed.url || unsubParsed.mailto);

  return {
    id: raw.id,
    threadId: raw.threadId,
    accountId,
    provider: 'gmail',
    from,
    subject,
    snippet: decodeHtmlEntities(raw.snippet || ''),
    dateMs,
    dateFormatted: formatEmailDate(dateMs),
    isUnread,
    isPromotional,
    isSpam,
    isTrash,
    hasAttachments: attachments.names.length > 0,
    attachmentBytes: attachments.totalBytes,
    sizeEstimate: raw.sizeEstimate || 0,
    attachmentNames: attachments.names,
    unsubscribeMailto: unsubParsed.mailto,
    unsubscribeUrl: unsubParsed.url,
    hasOneClickUnsubscribe: unsubParsed.oneClick,
    labels,
  };
}

function collectGmailAttachments(part?: GmailPayloadPart): {
  names: string[];
  totalBytes: number;
} {
  const names: string[] = [];
  let totalBytes = 0;
  function walk(node?: GmailPayloadPart) {
    if (!node) return;
    if (node.filename && node.filename.trim().length > 0) {
      names.push(node.filename.trim());
      totalBytes += node.body?.size || 0;
    }
    if (node.parts) {
      for (const child of node.parts) walk(child);
    }
  }
  walk(part);
  return { names, totalBytes };
}

function parseListUnsubscribeHeader(
  rawHeader: string,
  postHeader: string
): { mailto?: string; url?: string; oneClick: boolean } {
  if (!rawHeader) return { oneClick: false };
  let mailto: string | undefined;
  let url: string | undefined;
  const matches = rawHeader.match(/<([^>]+)>/g) || [];
  for (const m of matches) {
    const inner = m.slice(1, -1).trim();
    if (inner.toLowerCase().startsWith('mailto:') && !mailto) {
      mailto = inner;
    } else if (
      (inner.toLowerCase().startsWith('https://') ||
        inner.toLowerCase().startsWith('http://')) &&
      !url
    ) {
      url = inner;
    }
  }
  return {
    mailto,
    url,
    oneClick: postHeader.toLowerCase().includes('list-unsubscribe=one-click'),
  };
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function formatEmailDate(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

export async function performBulkEmailAction(params: {
  account: ConnectedEmailAccount;
  messageIds: string[];
  action: EmailBulkAction;
}): Promise<{ succeeded: number }> {
  const { account, messageIds, action } = params;
  if (messageIds.length === 0) return { succeeded: 0 };

  // Gmail messages.batchModify supports up to 1,000 IDs per call; chunk by 500 for safety
  const CHUNK_SIZE = 500;
  let succeeded = 0;

  for (let i = 0; i < messageIds.length; i += CHUNK_SIZE) {
    const chunk = messageIds.slice(i, i + CHUNK_SIZE);
    const body: { addLabelIds?: string[]; removeLabelIds?: string[]; ids: string[] } = {
      ids: chunk,
    };

    if (action === 'trash') {
      body.addLabelIds = ['TRASH'];
      body.removeLabelIds = ['INBOX', 'SPAM'];
    } else if (action === 'archive') {
      body.removeLabelIds = ['INBOX'];
    } else if (action === 'mark_read') {
      body.removeLabelIds = ['UNREAD'];
    } else if (action === 'mark_unread') {
      body.addLabelIds = ['UNREAD'];
    }

    const resp = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/batchModify',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${account.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );
    if (!resp.ok) {
      const errTxt = await resp.text();
      throw new Error(formatGmailApiError(resp.status, errTxt, 'Gmail batch action failed'));
    }
    succeeded += chunk.length;
  }

  // Update cached mailbox messages synchronously so every folder tab updates in 0ms
  const cached = emailCacheMap.get(account.id);
  if (cached) {
    const idSet = new Set(messageIds);
    const updatedMessages = cached.messages
      .map((msg) => {
        if (!idSet.has(msg.id)) return msg;
        if (action === 'trash') {
          return {
            ...msg,
            isTrash: true,
            isSpam: false,
            labels: [...msg.labels.filter((l) => l !== 'INBOX' && l !== 'SPAM'), 'TRASH'],
          };
        }
        if (action === 'archive') {
          return {
            ...msg,
            labels: msg.labels.filter((l) => l !== 'INBOX'),
          };
        }
        if (action === 'mark_read') {
          return {
            ...msg,
            isUnread: false,
            labels: msg.labels.filter((l) => l !== 'UNREAD'),
          };
        }
        if (action === 'mark_unread') {
          return {
            ...msg,
            isUnread: true,
            labels: msg.labels.includes('UNREAD') ? msg.labels : [...msg.labels, 'UNREAD'],
          };
        }
        return msg;
      })
      .filter((msg) => !msg.isTrash);

    emailCacheMap.set(account.id, {
      ...cached,
      loadedCount: updatedMessages.length,
      messages: updatedMessages,
    });
    notifyEmailCacheListeners();
  }

  return { succeeded };
}
