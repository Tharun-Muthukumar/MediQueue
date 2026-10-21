/** Thin fetch client: same-origin cookies, CSRF double-submit header, consistent error type. */

export const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api/v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
    public details?: Array<{ field: string; message: string }>,
  ) {
    super(message);
  }
}

function readCookie(name: string) {
  return document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

let csrfPromise: Promise<string> | null = null;
async function csrfToken(): Promise<string> {
  const existing = readCookie('mq_csrf');
  if (existing) return decodeURIComponent(existing);
  csrfPromise ??= fetch(`${API_BASE}/auth/csrf`, { credentials: 'include' })
    .then((r) => r.json())
    .then((j) => j.data.csrfToken as string)
    .finally(() => (csrfPromise = null));
  return csrfPromise;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json', ...(init.headers ?? {}) };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') headers['X-CSRF-Token'] = await csrfToken();

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the MediQueue server. Check that the backend is running on port 4000.');
  }

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await res.json() : null;
  if (!res.ok) {
    const e = payload?.error;
    throw new ApiError(res.status, e?.code ?? 'HTTP_ERROR', e?.message ?? `Request failed (${res.status})`, e?.requestId, e?.details);
  }
  return (payload && typeof payload === 'object' && 'data' in payload ? payload.data : payload) as T;
}

export const get = <T>(path: string) => api<T>(path);
export const post = <T>(path: string, body?: unknown, headers?: Record<string, string>) => api<T>(path, { method: 'POST', body: body ?? {}, headers });
export const patch = <T>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body: body ?? {} });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });

export function newIdempotencyKey() {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Downloads an authenticated file (e.g. the CSV report) through the session cookie. */
export async function download(path: string, fallbackName: string) {
  const res = await fetch(`${API_BASE}${path}`, { credentials: 'include' });
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    throw new ApiError(res.status, j?.error?.code ?? 'HTTP_ERROR', j?.error?.message ?? 'Download failed');
  }
  const blob = await res.blob();
  const name = res.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
