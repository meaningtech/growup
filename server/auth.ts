import { createHmac, createPublicKey, timingSafeEqual, verify, type JsonWebKey as CryptoJsonWebKey } from 'node:crypto';
import type { Request, Response } from 'express';
import type { GoogleIdentity, GrowupUser } from './mongo.js';

const SESSION_COOKIE = 'growup_session';
const SESSION_DURATION_SECONDS = 7 * 24 * 60 * 60;
const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
type GoogleJwk = CryptoJsonWebKey & { kid?: string };
let cachedKeys: { expiresAt: number; keys: GoogleJwk[] } | null = null;

export type AuthConfig = {
  googleOAuthClientId?: string;
  authSessionSecret?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  verifyGoogleToken?: (credential: string, clientId: string) => Promise<GoogleIdentity>;
};

export type AuthStore = {
  getUser: (id: string) => Promise<GrowupUser | null>;
  upsertUser: (identity: GoogleIdentity) => Promise<GrowupUser>;
};

type SessionPayload = { subject: string; issuedAt: number; expiresAt: number };
type GoogleTokenHeader = { alg?: string; kid?: string };
type GoogleTokenPayload = {
  aud?: string;
  iss?: string;
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  locale?: string;
  exp?: number;
  iat?: number;
};

export function authStatus(config: AuthConfig = {}) {
  const clientId = config.googleOAuthClientId ?? process.env.GOOGLE_OAUTH_CLIENT_ID ?? '';
  return { configured: Boolean(clientId && sessionSecret(config)), googleClientId: clientId };
}

export async function signInWithGoogle(credential: string, store: AuthStore, config: AuthConfig = {}): Promise<{ user: GrowupUser; cookie: string }> {
  const { configured, googleClientId } = authStatus(config);
  if (!configured) throw authError(503, 'GOOGLE_AUTH_NOT_CONFIGURED', 'Google sign-in is not configured for Growup yet.');
  if (!credential || credential.length > 16_000) throw authError(400, 'INVALID_GOOGLE_CREDENTIAL', 'A Google ID credential is required.');
  const identity = await (config.verifyGoogleToken ?? ((token, clientId) => verifyGoogleIdToken(token, clientId, config)))(credential, googleClientId);
  const user = await store.upsertUser(identity);
  return { user, cookie: sessionCookie(user.id, config) };
}

export async function authenticatedUser(request: Request, store: AuthStore, config: AuthConfig = {}): Promise<GrowupUser | null> {
  const token = cookies(request.headers.cookie ?? '')[SESSION_COOKIE];
  if (!token) return null;
  const payload = verifySession(token, config);
  if (!payload) return null;
  return store.getUser(payload.subject);
}

export async function requireAuthenticatedUser(request: Request, store: AuthStore, config: AuthConfig = {}): Promise<GrowupUser> {
  const user = await authenticatedUser(request, store, config);
  if (!user) throw authError(401, 'AUTHENTICATION_REQUIRED', 'Sign in with Google to save and open Growup projects.');
  return user;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookieSuffix()}`;
}

export function setSessionResponseCookie(response: Response, cookie: string) {
  response.setHeader('Set-Cookie', cookie);
}

async function verifyGoogleIdToken(credential: string, clientId: string, config: AuthConfig): Promise<GoogleIdentity> {
  const parts = credential.split('.');
  if (parts.length !== 3) throw authError(401, 'INVALID_GOOGLE_CREDENTIAL', 'Google returned an invalid ID token.');
  const header = parseJwtPart<GoogleTokenHeader>(parts[0]);
  const payload = parseJwtPart<GoogleTokenPayload>(parts[1]);
  if (header.alg !== 'RS256' || !header.kid) throw authError(401, 'INVALID_GOOGLE_CREDENTIAL', 'The Google ID token algorithm is not accepted.');
  const keys = await googleKeys(config);
  const key = keys.find((candidate) => candidate.kid === header.kid);
  if (!key) throw authError(401, 'INVALID_GOOGLE_CREDENTIAL', 'The Google ID token signing key is unknown.');
  const validSignature = verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key, format: 'jwk' }), Buffer.from(parts[2], 'base64url'));
  if (!validSignature) throw authError(401, 'INVALID_GOOGLE_CREDENTIAL', 'The Google ID token signature is invalid.');
  const now = Math.floor((config.now?.() ?? new Date()).getTime() / 1000);
  if (payload.aud !== clientId || !['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss ?? '')) throw authError(401, 'INVALID_GOOGLE_CREDENTIAL', 'The Google ID token was issued for another application.');
  if (!payload.exp || payload.exp <= now || !payload.iat || payload.iat > now + 60) throw authError(401, 'EXPIRED_GOOGLE_CREDENTIAL', 'The Google ID token is expired or not active yet.');
  if (!payload.email_verified || !payload.sub || !payload.email) throw authError(401, 'UNVERIFIED_GOOGLE_ACCOUNT', 'Growup requires a verified Google account email.');
  return {
    subject: payload.sub,
    email: payload.email.toLowerCase(),
    name: payload.name?.trim() || payload.email.split('@')[0],
    pictureUrl: payload.picture ?? null,
    locale: payload.locale ?? null,
  };
}

async function googleKeys(config: AuthConfig): Promise<GoogleJwk[]> {
  const now = (config.now?.() ?? new Date()).getTime();
  if (cachedKeys && cachedKeys.expiresAt > now) return cachedKeys.keys;
  const response = await (config.fetchImpl ?? fetch)(GOOGLE_CERTS_URL, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw authError(502, 'GOOGLE_KEYS_UNAVAILABLE', 'Google signing keys are temporarily unavailable.');
  const body = await response.json() as { keys?: GoogleJwk[] };
  const keys = body.keys ?? [];
  if (!keys.length) throw authError(502, 'GOOGLE_KEYS_UNAVAILABLE', 'Google returned no signing keys.');
  const maxAge = Number(response.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1] ?? 3600);
  cachedKeys = { keys, expiresAt: now + Math.max(300, maxAge) * 1000 };
  return keys;
}

function sessionCookie(subject: string, config: AuthConfig) {
  const issuedAt = Math.floor((config.now?.() ?? new Date()).getTime() / 1000);
  const payload: SessionPayload = { subject, issuedAt, expiresAt: issuedAt + SESSION_DURATION_SECONDS };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign(encoded, config);
  return `${SESSION_COOKIE}=${encoded}.${signature}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DURATION_SECONDS}${secureCookieSuffix()}`;
}

function verifySession(value: string, config: AuthConfig): SessionPayload | null {
  const [encoded, signature] = value.split('.');
  if (!encoded || !signature) return null;
  const expected = sign(encoded, config);
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    const now = Math.floor((config.now?.() ?? new Date()).getTime() / 1000);
    return typeof payload.subject === 'string' && payload.issuedAt <= now + 60 && payload.expiresAt > now ? payload : null;
  } catch {
    return null;
  }
}

function sign(value: string, config: AuthConfig) {
  return createHmac('sha256', sessionSecret(config)).update(value).digest('base64url');
}

function sessionSecret(config: AuthConfig) {
  return config.authSessionSecret ?? process.env.AUTH_SESSION_SECRET ?? '';
}

function parseJwtPart<T>(value: string): T {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T;
  } catch {
    throw authError(401, 'INVALID_GOOGLE_CREDENTIAL', 'Google returned an unreadable ID token.');
  }
}

function cookies(header: string): Record<string, string> {
  return Object.fromEntries(header.split(';').flatMap((item) => {
    const separator = item.indexOf('=');
    return separator > 0 ? [[item.slice(0, separator).trim(), item.slice(separator + 1).trim()]] : [];
  }));
}

function secureCookieSuffix() {
  return process.env.NODE_ENV === 'production' ? '; Secure' : '';
}

function authError(code: number, status: string, message: string) {
  return { code, status, message };
}
