const X_BASE_URL = "/agent/x";

interface XAuthStartResponse {
  success: boolean;
  authUrl?: string;
  error?: string;
}

interface XAuthStatusResponse {
  success: boolean;
  connected: boolean;
  scopes: string[];
  hasMediaWrite: boolean;
  error?: string;
}

interface XActionResponse {
  success: boolean;
  updatedCount?: number;
  mentionCount?: number;
  error?: string;
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = data && typeof data === "object" && "error" in data ? (data as { error?: string }).error : undefined;
    throw new Error(error || `Request failed (${response.status})`);
  }
  return data as T;
}

async function getAuthStatus(): Promise<XAuthStatusResponse> {
  return fetchJson<XAuthStatusResponse>(`${X_BASE_URL}/status`);
}

export async function initXAuth(): Promise<string> {
  const data = await fetchJson<XAuthStartResponse>(`${X_BASE_URL}/auth/start`, {
    method: "POST",
  });
  if (!data.success || !data.authUrl) {
    throw new Error(data.error || "Failed to start X OAuth.");
  }
  return data.authUrl;
}

export async function handleXAuthCallback(code: string, state: string): Promise<void> {
  const data = await fetchJson<XActionResponse>(`${X_BASE_URL}/auth/callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, state }),
  });
  if (!data.success) {
    throw new Error(data.error || "Failed to complete X OAuth callback.");
  }
}

export async function isXConnected(): Promise<boolean> {
  const data = await getAuthStatus();
  return data.connected;
}

export async function hasXScope(scope: string): Promise<boolean | null> {
  const data = await getAuthStatus();
  if (!data.connected) return null;
  return data.scopes.includes(scope);
}

export async function revokeXAuth(): Promise<void> {
  const data = await fetchJson<XActionResponse>(`${X_BASE_URL}/auth/revoke`, {
    method: "POST",
  });
  if (!data.success) {
    throw new Error(data.error || "Failed to revoke X OAuth.");
  }
}

export async function refreshRecentTweetMetrics(): Promise<number> {
  const data = await fetchJson<XActionResponse>(`${X_BASE_URL}/metrics/refresh`, {
    method: "POST",
  });
  if (!data.success) {
    throw new Error(data.error || "Failed to refresh X tweet metrics.");
  }
  return data.updatedCount ?? 0;
}
