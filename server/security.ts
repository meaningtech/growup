import type { NextFunction, Request, Response } from 'express';

export type SecurityConfig = {
  allowedOrigins?: string[];
  rateLimitWindowMs?: number;
  assistantRateLimit?: number;
  computeRateLimit?: number;
  authRateLimit?: number;
  now?: () => Date;
};

type RateBucket = { count: number; resetAt: number };

export function allowedOrigins(config: SecurityConfig = {}): Set<string> {
  const configured = config.allowedOrigins ?? splitOrigins(process.env.ALLOWED_ORIGINS);
  const origins = new Set(configured.length ? configured : ['https://growup.earth']);
  if (process.env.NODE_ENV !== 'production') {
    origins.add('http://127.0.0.1:5173');
    origins.add('http://127.0.0.1:52174');
    origins.add('http://localhost:5173');
    origins.add('http://localhost:52174');
  }
  return origins;
}

export function securityHeaders(request: Request, response: Response, next: NextFunction) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('X-Frame-Options', 'SAMEORIGIN');
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), payment=(), usb=(), geolocation=(self)');
  response.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self' https://accounts.google.com",
    "frame-ancestors 'self'",
    "script-src 'self' 'unsafe-inline' https://maps.googleapis.com https://maps.gstatic.com https://accounts.google.com https://accounts.gstatic.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https://maps.googleapis.com https://maps.gstatic.com https://accounts.google.com",
    "frame-src https://accounts.google.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join('; '));
  if (process.env.NODE_ENV === 'production' || request.secure || request.headers['x-forwarded-proto'] === 'https') {
    response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

export function rateLimit(label: string, maximum: number, config: SecurityConfig = {}) {
  const buckets = new Map<string, RateBucket>();
  const windowMs = Math.max(1_000, config.rateLimitWindowMs ?? 60_000);
  return (request: Request, response: Response, next: NextFunction) => {
    const now = (config.now?.() ?? new Date()).getTime();
    const key = `${label}:${request.ip}`;
    const current = buckets.get(key);
    const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
    bucket.count += 1;
    buckets.set(key, bucket);
    const remaining = Math.max(0, maximum - bucket.count);
    response.setHeader('RateLimit-Limit', String(maximum));
    response.setHeader('RateLimit-Remaining', String(remaining));
    response.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1_000)));
    if (bucket.count > maximum) {
      response.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000))));
      response.status(429).json({ error: { code: 429, status: 'RATE_LIMITED', message: 'Too many requests. Retry after the current planning window.' } });
      return;
    }
    if (buckets.size > 5_000) pruneBuckets(buckets, now);
    next();
  };
}

function splitOrigins(value: string | undefined): string[] {
  return (value ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
}

function pruneBuckets(buckets: Map<string, RateBucket>, now: number) {
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
}
