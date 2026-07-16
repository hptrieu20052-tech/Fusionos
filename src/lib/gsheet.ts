import crypto from "crypto";

// Google Sheets qua SERVICE ACCOUNT: tự ký JWT RS256 → đổi lấy access token. Không cần SDK nặng.
// Env: GOOGLE_SA_EMAIL (client_email), GOOGLE_SA_KEY (private_key, có thể chứa \n literal).
const SA_EMAIL = process.env.GOOGLE_SA_EMAIL ?? "";
const SA_KEY = (process.env.GOOGLE_SA_KEY ?? "").replace(/\\n/g, "\n");
const API = "https://sheets.googleapis.com/v4/spreadsheets";

let cachedToken: { token: string; exp: number } | null = null;

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getAccessToken(): Promise<string> {
  if (!SA_EMAIL || !SA_KEY) throw new Error("Thiếu GOOGLE_SA_EMAIL / GOOGLE_SA_KEY trong env.");
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp > now + 60) return cachedToken.token;

  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: SA_EMAIL,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
  }));
  const unsigned = `${header}.${claim}`;
  const sig = crypto.sign("RSA-SHA256", Buffer.from(unsigned), SA_KEY);
  const jwt = `${unsigned}.${b64url(sig)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Google auth HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { access_token: string; expires_in?: number };
  cachedToken = { token: j.access_token, exp: now + (j.expires_in ?? 3600) };
  return j.access_token;
}

// Đọc hàng header (hàng 1) của tab → mảng tên cột
export async function getSheetHeaders(sheetId: string, tab: string): Promise<string[]> {
  const token = await getAccessToken();
  const range = encodeURIComponent(`${tab}!1:1`);
  const res = await fetch(`${API}/${sheetId}/values/${range}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Sheets read header HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { values?: unknown[][] };
  return (j.values?.[0] ?? []).map((h) => String(h ?? ""));
}

// Append 1 dòng vào cuối tab
export async function appendSheetRow(sheetId: string, tab: string, row: (string | number)[]): Promise<void> {
  const token = await getAccessToken();
  const range = encodeURIComponent(`${tab}!A1`);
  const res = await fetch(`${API}/${sheetId}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [row] }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Sheets append HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// Đọc toàn bộ tab → { headers, rows } (rows KHÔNG gồm header). Dùng cho cron đọc tracking về.
export async function readSheet(sheetId: string, tab: string): Promise<{ headers: string[]; rows: string[][] }> {
  const token = await getAccessToken();
  const range = encodeURIComponent(tab);
  const res = await fetch(`${API}/${sheetId}/values/${range}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Sheets read HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { values?: unknown[][] };
  const values = j.values ?? [];
  const headers = (values[0] ?? []).map((h) => String(h ?? ""));
  const rows = values.slice(1).map((r) => (r ?? []).map((c) => String(c ?? "")));
  return { headers, rows };
}

// Ghi 1 ô (A1 notation, vd "B5") — để đánh dấu đã import nếu cần
export async function updateSheetCell(sheetId: string, tab: string, a1: string, value: string): Promise<void> {
  const token = await getAccessToken();
  const range = encodeURIComponent(`${tab}!${a1}`);
  const res = await fetch(`${API}/${sheetId}/values/${range}?valueInputOption=RAW`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ values: [[value]] }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Sheets update HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// Chuẩn hoá tên cột để map (bỏ hoa/thường, khoảng trắng, ngoặc chú thích, \n)
export function normHeader(h: string): string {
  return h.toLowerCase().replace(/\(.*?\)/g, "").replace(/[\n\r]/g, " ").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
