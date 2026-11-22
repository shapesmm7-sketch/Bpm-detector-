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

// Strict in-memory token store (NEVER persisted to localStorage or sessionStorage)
const connectedAccountsMap = new Map<string, ConnectedEmailAccount>();

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
  if (!acct?.accessToken) return;

  if (isNativeAndroid()) {
    try {
      await GmailAuth.clearCachedToken({ token: acct.accessToken });
    } catch {
      // ignore token clear failure
    }
    return;
  }

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
  return account;
}

export interface FetchEmailsOptions {
  account: ConnectedEmailAccount;
  view: EmailFilterView;
  searchQuery?: string;
  readFilter?: 'all' | 'unread' | 'read';
  olderThanDays?: number;
  customBeforeDate?: string; // YYYY-MM-DD
  pageToken?: string;
  maxResults?: number;
}

export interface FetchEmailsResult {
  messages: EmailMessageSummary[];
  nextPageToken?: string;
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

async function fetchGmailMessages(opts: FetchEmailsOptions): Promise<FetchEmailsResult> {
  const maxResults = opts.maxResults ?? 20;
  const q = buildGmailQuery(opts);
  const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
  listUrl.searchParams.set('maxResults', String(maxResults));
  if (q) listUrl.searchParams.set('q', q);
  if (opts.view === 'spam') listUrl.searchParams.set('includeSpamTrash', 'true');
  if (opts.pageToken) listUrl.searchParams.set('pageToken', opts.pageToken);

  const listResp = await fetch(listUrl.toString(), {
    headers: { Authorization: `Bearer ${opts.account.accessToken}` },
  });
  if (!listResp.ok) {
    const txt = await listResp.text();
    throw new Error(`Gmail API error (${listResp.status}): ${txt}`);
  }
  const listData = (await listResp.json()) as {
    messages?: Array<{ id: string }>;
    nextPageToken?: string;
  };

  const refs = listData.messages || [];
  if (refs.length === 0) {
    return { messages: [], nextPageToken: undefined };
  }

  const details = await Promise.all(
    refs.map(async (ref) => {
      const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(
        ref.id
      )}?format=full`;
      const resp = await fetch(msgUrl, {
        headers: { Authorization: `Bearer ${opts.account.accessToken}` },
      });
      if (!resp.ok) return null;
      const raw = (await resp.json()) as GmailMessageRaw;
      return parseGmailMessage(raw, opts.account.id);
    })
  );

  let messages = details.filter((m): m is EmailMessageSummary => m !== null);
  if (opts.view === 'large_attachments') {
    messages.sort((a, b) => b.attachmentBytes - a.attachmentBytes);
  } else if (opts.view === 'unsubscribe') {
    messages = messages.filter((m) => Boolean(m.unsubscribeUrl || m.unsubscribeMailto));
  }

  return {
    messages,
    nextPageToken: listData.nextPageToken,
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

  if (action === 'trash') {
    let ok = 0;
    for (const id of messageIds) {
      const resp = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}/trash`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${account.accessToken}` },
        }
      );
      if (resp.ok) ok++;
    }
    return { succeeded: ok };
  }

  const body: { addLabelIds?: string[]; removeLabelIds?: string[]; ids: string[] } = {
    ids: messageIds,
  };
  if (action === 'archive') {
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
    throw new Error(`Gmail batch action failed (${resp.status}): ${errTxt}`);
  }
  return { succeeded: messageIds.length };
}
