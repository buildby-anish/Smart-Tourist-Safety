import { SOSRecord, getQueuedSOSRecords, updateSOSRecordStatus } from "./db";

let isSyncing = false;

// ---------------------------------------------------------------------------
// Base URL & session storage
//
// Resolution order matches existing behavior (localStorage override first),
// and additionally honors Vite's standard VITE_* env convention so a
// deployment-specific URL can be set via frontend/.env without code changes.
// ---------------------------------------------------------------------------

export function getApiBaseUrl(): string {
  // @ts-ignore
  const envUrl = import.meta.env.VITE_API_BASE_URL;
  const localUrl = localStorage.getItem("sos_api_base_url");
  if (localUrl && !localUrl.includes("localhost") && !localUrl.includes("127.0.0.1")) {
    return localUrl;
  }
  return envUrl || localUrl || "http://localhost:8000/api/v1";
}

export function getAuthToken(): string {
  return localStorage.getItem("sos_auth_token") || "";
}

export function getRefreshToken(): string {
  return localStorage.getItem("sos_refresh_token") || "";
}

export function getTouristId(): string {
  // Storage key kept as "sos_tourist_id" for backward compatibility with
  // already-installed clients; the value stored here is the backend's
  // tourist_profile_id (internal UUID), not the public TOUR-YYYY-HEX code.
  return localStorage.getItem("sos_tourist_id") || "";
}

export function getUserType(): string {
  return localStorage.getItem("sos_user_type") || "";
}

export function getAuthorityId(): string {
  return localStorage.getItem("sos_authority_id") || "";
}

export function getUsername(): string {
  return localStorage.getItem("sos_username") || "";
}

interface SessionInfo {
  access_token?: string;
  refresh_token?: string | null;
  user_type?: string;
  tourist_profile_id?: string | null;
  authority_id?: string | null;
  username?: string;
}

/** Persists an authenticated session (token + identity) to localStorage. */
export function storeSession(session: SessionInfo): void {
  if (session.access_token) localStorage.setItem("sos_auth_token", session.access_token);
  if (session.refresh_token) localStorage.setItem("sos_refresh_token", session.refresh_token);
  if (session.user_type) localStorage.setItem("sos_user_type", session.user_type);
  if (session.tourist_profile_id) localStorage.setItem("sos_tourist_id", session.tourist_profile_id);
  if (session.authority_id) localStorage.setItem("sos_authority_id", session.authority_id);
  if (session.username) localStorage.setItem("sos_username", session.username);
}

/** Clears any stored session/auth data (used on logout). */
export function clearSession(): void {
  localStorage.removeItem("sos_auth_token");
  localStorage.removeItem("sos_refresh_token");
  localStorage.removeItem("sos_user_type");
  localStorage.removeItem("sos_tourist_id");
  localStorage.removeItem("sos_authority_id");
  localStorage.removeItem("sos_username");
}

/**
 * Exchanges the stored refresh token for a new access token. Supabase
 * rotates refresh tokens on every use, so the new one returned here MUST
 * replace the stored one — reusing an already-consumed refresh token will
 * fail on the next attempt.
 *
 * Returns true on success (session silently renewed), false if the
 * refresh token itself is invalid/expired (caller should treat this as a
 * real logout, not retry).
 */
export async function tryRefreshSession(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  try {
    const resp = await fetch(`${getApiBaseUrl()}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!resp.ok) return false;
    const data = await resp.json();
    if (!data.access_token) return false;
    localStorage.setItem("sos_auth_token", data.access_token);
    if (data.refresh_token) localStorage.setItem("sos_refresh_token", data.refresh_token);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Generic authenticated request helper
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function doFetch(path: string, method: string, body: any, token: string): Promise<Response> {
  const baseUrl = getApiBaseUrl();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function apiRequest<T = any>(
  path: string,
  options: { method?: string; body?: any; auth?: boolean } = {}
): Promise<T> {
  const { method = "GET", body, auth = true } = options;
  const token = getAuthToken();

  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(auth && token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (networkErr: any) {
    throw new ApiError(0, `Network error contacting backend: ${networkErr.message || networkErr}`);
  }

  // A 401 on an authenticated request usually means the ~1hr access token
  // expired (not that the user was ever "logged out"). Silently exchange
  // the refresh token for a new one and retry exactly once before giving
  // up — this is what keeps a session alive across page reloads until the
  // person actually signs out, instead of forcing re-login every hour.
  if (response.status === 401 && auth && token) {
    const refreshed = await tryRefreshSession();
    if (refreshed) {
      try {
        response = await doFetch(path, method, body, getAuthToken());
      } catch (networkErr: any) {
        throw new ApiError(0, `Network error contacting backend: ${networkErr.message || networkErr}`);
      }
    }
  }

  if (!response.ok) {
    let detail = "";
    try {
      const errJson = await response.json();
      detail = errJson.detail ? JSON.stringify(errJson.detail) : JSON.stringify(errJson);
    } catch {
      detail = await response.text().catch(() => "");
    }
    throw new ApiError(response.status, detail || `Request failed with status ${response.status}`);
  }

  if (response.status === 204) return undefined as unknown as T;
  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Authentication (backend/routers/auth.py)
// ---------------------------------------------------------------------------

export async function registerUser(
  username: string,
  password: string,
  userType: "tourist" | "authority",
  extra?: { fullName?: string; phoneNumber?: string }
): Promise<any> {
  return apiRequest("/auth/register", {
    method: "POST",
    auth: false,
    body: {
      username,
      password,
      user_type: userType,
      full_name: extra?.fullName,
      phone_number: extra?.phoneNumber,
    },
  });
}

export async function loginUser(username: string, password: string): Promise<any> {
  return apiRequest("/auth/login", {
    method: "POST",
    auth: false,
    body: { username, password },
  });
}

export async function logoutUser(): Promise<void> {
  try {
    await apiRequest("/auth/logout", { method: "POST" });
  } catch (err) {
    console.warn("Logout request failed (clearing local session anyway):", err);
  }
}

export async function getSession(): Promise<any> {
  return apiRequest("/auth/session");
}

/** Requests a fresh OTP for the given phone number (logged server-side for testing). */
export async function sendOtp(phone: string): Promise<any> {
  return apiRequest("/auth/send-otp", {
    method: "POST",
    auth: false,
    body: { phone },
  });
}

/** Verifies a user-entered OTP against the code generated by sendOtp(). */
export async function verifyOtp(phone: string, otp: string): Promise<{ verified: boolean; message: string }> {
  return apiRequest("/auth/verify-otp", {
    method: "POST",
    auth: false,
    body: { phone, otp },
  });
}

/**
 * The existing Tourist Portal sign-up/sign-in UI never collects a password
 * (only name/phone/email/OTP). The backend's register/login endpoints require
 * username + password. To connect the two without adding a new field to the
 * existing form, we derive stable, non-secret credentials from the tourist's
 * phone number. This is a pragmatic integration bridge for this app, not a
 * production-grade auth scheme.
 */
export function deriveTouristCredentials(phoneOrEmail: string): { username: string; password: string } {
  const isEmail = (phoneOrEmail || "").includes("@");
  if (isEmail) {
    const cleanEmail = phoneOrEmail.trim().toLowerCase();
    const hash = cleanEmail.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return {
      username: cleanEmail,
      password: `SurakshaSetu-${hash}-2026`,
    };
  } else {
    const normalized = (phoneOrEmail || "").replace(/[^0-9]/g, "");
    return {
      username: `tourist-${normalized || "guest"}`,
      password: `SurakshaSetu-${normalized || "guest"}-2026`,
    };
  }
}

// ---------------------------------------------------------------------------
// Tourist profile (backend/routers/tourists.py)
// ---------------------------------------------------------------------------

export async function createTouristProfile(payload: {
  username: string;
  full_name: string;
  phone_number?: string;
  email?: string;
  emergency_contacts?: { name?: string; relation?: string; phone?: string }[];
  preferred_language?: string;
}): Promise<any> {
  return apiRequest("/tourists", { method: "POST", body: payload });
}

export async function getTouristProfile(touristId: string): Promise<any> {
  return apiRequest(`/tourists/${touristId}`);
}

export async function updateTouristProfile(touristId: string, payload: Record<string, any>): Promise<any> {
  return apiRequest(`/tourists/${touristId}`, { method: "PATCH", body: payload });
}

export async function getDigitalId(touristId: string): Promise<any> {
  return apiRequest(`/tourists/${touristId}/digital-id`);
}

// ---------------------------------------------------------------------------
// DigiLocker KYC (backend/digilocker/router.py) — an additional, swappable
// verification path alongside the OCR upload flow in lib/verificationApi.ts.
// Both end at the same tourist_profiles update, so either result can be
// passed to finishSignup the same way handleKycComplete already does for OCR.
// ---------------------------------------------------------------------------

export interface DigiLockerInitiateResult {
  session_id: string;
  status: string;
  auth_url: string | null;
  mock_mode: boolean;
}

export interface DigiLockerFetchResult {
  session_id: string;
  status: string;
  document_type: string;
  masked_document_number: string;
  full_name: string;
  mock_mode: boolean;
}

export interface DigiLockerConfirmResult {
  session_id: string;
  status: string;
  tourist_id: string;
  kyc_status: string;
  blockchain_tx_hash: string | null;
  blockchain_block_number: number | null;
  blockchain_adapter: "mock" | "sepolia" | null;
}

export async function initiateDigiLocker(
  touristId: string,
  documentType: "AADHAAR" | "PAN" | "DRIVING_LICENCE" | "VOTER_ID"
): Promise<DigiLockerInitiateResult> {
  return apiRequest(`/digilocker/initiate`, {
    method: "POST",
    body: { tourist_id: touristId, document_type: documentType },
  });
}

export async function fetchDigiLockerDocument(sessionId: string): Promise<DigiLockerFetchResult> {
  return apiRequest(`/digilocker/fetch/${sessionId}`, { method: "POST" });
}

export async function confirmDigiLocker(sessionId: string): Promise<DigiLockerConfirmResult> {
  return apiRequest(`/digilocker/confirm`, { method: "POST", body: { session_id: sessionId } });
}

export async function getDigiLockerStatus(sessionId: string): Promise<any> {
  return apiRequest(`/digilocker/status/${sessionId}`);
}

// ---------------------------------------------------------------------------
// Incidents (backend/routers/incidents.py)
// ---------------------------------------------------------------------------

export async function listIncidents(statusFilter?: string): Promise<any[]> {
  const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : "";
  return apiRequest(`/incidents${qs}`);
}

export async function getIncident(incidentId: string): Promise<any> {
  return apiRequest(`/incidents/${incidentId}`);
}

export async function updateIncidentStatus(
  incidentId: string,
  payload: { status?: string; priority?: string; ai_risk_score?: number; description?: string; assigned_officer_id?: string }
): Promise<any> {
  return apiRequest(`/incidents/${incidentId}`, { method: "PATCH", body: payload });
}

export async function createIncidentResponse(
  incidentId: string,
  payload: { responder_unit?: string; action_taken?: string; resolved_at?: string; authority_id?: string }
): Promise<any> {
  return apiRequest(`/incidents/${incidentId}/responses`, { method: "POST", body: payload });
}

export async function listIncidentResponses(incidentId: string): Promise<any[]> {
  return apiRequest(`/incidents/${incidentId}/responses`);
}

export interface ItineraryDestination {
  name: string;
  latitude?: number;
  longitude?: number;
  activity_tags?: string[];
  planned_arrival?: string;
  planned_departure?: string;
}

export async function createItinerary(payload: {
  title: string;
  destinations?: ItineraryDestination[];
  start_date?: string;
  end_date?: string;
}): Promise<any> {
  return apiRequest(`/itinerary`, { method: "POST", body: payload });
}

export async function listItineraries(): Promise<any[]> {
  return apiRequest(`/itinerary`);
}

export async function updateItinerary(
  itineraryId: string,
  payload: { title?: string; destinations?: ItineraryDestination[]; start_date?: string; end_date?: string }
): Promise<any> {
  return apiRequest(`/itinerary/${itineraryId}`, { method: "PATCH", body: payload });
}

export async function deleteItinerary(itineraryId: string): Promise<void> {
  await apiRequest(`/itinerary/${itineraryId}`, { method: "DELETE" });
}

export async function createAuditLog(payload: {
  action_type: string;
  target_id: string;
  reason?: string;
  details?: string;
}): Promise<any> {
  return apiRequest(`/audit-logs`, { method: "POST", body: payload });
}

export async function listAuditLogs(): Promise<any[]> {
  return apiRequest(`/audit-logs`);
}

// ---------------------------------------------------------------------------
// Locations (backend/routers/locations.py)
// ---------------------------------------------------------------------------

export async function listPointsOfInterest(): Promise<any[]> {
  return apiRequest("/points-of-interest");
}

export async function getPointOfInterest(poiId: string): Promise<any> {
  return apiRequest(`/points-of-interest/${poiId}`);
}

/** Reports a live GPS ping — feeds the backend's geofencing check and the authority dashboard's live tracker. */
export async function reportLocationPing(payload: {
  latitude: number;
  longitude: number;
  speed?: number;
  heading?: number;
}): Promise<any> {
  return apiRequest("/locations", { method: "POST", body: payload });
}

export async function getTouristLocationHistory(touristId: string, limit = 100): Promise<any[]> {
  return apiRequest(`/locations/tourist/${touristId}?limit=${limit}`);
}

// ---------------------------------------------------------------------------
// Geofences (backend/routers/geofences.py)
// ---------------------------------------------------------------------------

export interface GeofenceZone {
  id: string;
  name: string;
  zone_type: "SAFE" | "BUFFER" | "RESTRICTED" | "UNSAFE" | "WARNING";
  geometry_type?: "CIRCLE" | "POLYGON";
  coordinates?: [number, number][] | null; // [lng, lat] ring, POLYGON only
  center_lat?: number | null;
  center_lng?: number | null;
  radius_m?: number | null;
  severity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  warning_message?: string | null;
  is_crowd_zone?: boolean;
  is_active: boolean;
  created_at: string;
}

export async function listGeofences(activeOnly = true): Promise<GeofenceZone[]> {
  return apiRequest(`/geofences?active_only=${activeOnly}`);
}

export async function createGeofence(payload: {
  name: string;
  zone_type: GeofenceZone["zone_type"];
  geometry_type?: "CIRCLE" | "POLYGON";
  coordinates?: [number, number][];
  center_lat?: number;
  center_lng?: number;
  radius_m?: number;
  severity?: GeofenceZone["severity"];
  warning_message?: string;
  is_crowd_zone?: boolean;
  is_active?: boolean;
}): Promise<GeofenceZone> {
  return apiRequest(`/geofences`, { method: "POST", body: payload });
}

export async function updateGeofence(geofenceId: string, payload: Record<string, any>): Promise<GeofenceZone> {
  return apiRequest(`/geofences/${geofenceId}`, { method: "PATCH", body: payload });
}

export async function deleteGeofence(geofenceId: string): Promise<void> {
  return apiRequest(`/geofences/${geofenceId}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Alerts (backend/routers/alerts.py)
// ---------------------------------------------------------------------------

export async function createAlert(payload: {
  incident_id: string;
  channel: "SMS" | "EMAIL" | "PUSH" | "APP";
  recipient: string;
}): Promise<any> {
  return apiRequest("/alerts", { method: "POST", body: payload });
}

export async function listAlerts(incidentId?: string): Promise<any[]> {
  const qs = incidentId ? `?incident_id=${encodeURIComponent(incidentId)}` : "";
  return apiRequest(`/alerts${qs}`);
}

// ---------------------------------------------------------------------------
// Authority (backend/routers/authority.py)
// ---------------------------------------------------------------------------

export async function authorityLoginRequest(username: string, password: string): Promise<any> {
  return apiRequest("/authority/login", { method: "POST", auth: false, body: { username, password } });
}

export async function getAuthorityAlerts(): Promise<any[]> {
  return apiRequest("/authority/alerts");
}

export async function getAuthorityIncidents(): Promise<any[]> {
  return apiRequest("/authority/incidents");
}

export async function getAuthorityTourist(touristId: string): Promise<any> {
  return apiRequest(`/authority/tourists/${touristId}`);
}

export async function getAuthorityIncidentLocation(incidentId: string): Promise<any> {
  return apiRequest(`/authority/incidents/${incidentId}/location`);
}

/**
 * Every tourist's current/last-known position in one call — used to seed
 * the authority map's markers on mount. After this initial hydration,
 * position updates arrive incrementally via the existing `location.ping`
 * events on the authority websocket feed (connectAuthorityFeed) — this is
 * not polled.
 */
export async function getLiveTouristLocations(): Promise<any[]> {
  return apiRequest("/authority/locations/live");
}

export async function listAuthorityTourists(): Promise<any[]> {
  return apiRequest("/authority/tourists");
}

/**
 * Connects the Gateway's existing MFA form (Badge ID + Auth Code) to the real
 * backend. The Auth Code field is already a masked "password" input in the
 * UI, so Badge ID -> username and Auth Code -> password is a direct mapping,
 * not an invented one.
 *
 * If the badge is not registered, or the credentials are otherwise invalid,
 * login simply fails — there is no auto-registration fallback. Authority
 * accounts must be provisioned separately.
 */
export async function authenticateAuthority(
  badgeId: string,
  otp: string
): Promise<{ authority_id: string; username: string } | null> {
  try {
    const loginResp = await authorityLoginRequest(badgeId, otp);
    storeSession({
      access_token: loginResp.access_token,
      refresh_token: loginResp.refresh_token,
      user_type: loginResp.user_type,
      authority_id: loginResp.authority_id,
      username: loginResp.username,
    });
    return { authority_id: loginResp.authority_id, username: loginResp.username };
  } catch (err: any) {
    console.error("Authority login failed:", err);
    return null;
  }
}

/** Opens the authority realtime feed (SOS/incident/location/geofence-breach events). */
export function connectAuthorityFeed(onEvent: (event: { type: string; data: any }) => void): WebSocket | null {
  const token = getAuthToken();
  if (!token) return null;
  const wsBase = getApiBaseUrl().replace(/^http/, "ws");
  const socket = new WebSocket(`${wsBase}/ws/authority?token=${encodeURIComponent(token)}`);
  socket.onmessage = (msg) => {
    try { onEvent(JSON.parse(msg.data)); } catch { /* ignore malformed frame */ }
  };
  return socket;
}

/** Opens a tourist's own realtime feed (geofence alert popups, SOS status updates). */
export function connectTouristFeed(
  touristId: string,
  onEvent: (event: { type: string; data: any }) => void
): WebSocket | null {
  const token = getAuthToken();
  if (!token || !touristId) return null;
  const wsBase = getApiBaseUrl().replace(/^http/, "ws");
  const socket = new WebSocket(`${wsBase}/ws/tourist/${touristId}?token=${encodeURIComponent(token)}`);
  socket.onmessage = (msg) => {
    try { onEvent(JSON.parse(msg.data)); } catch { /* ignore malformed frame */ }
  };
  return socket;
}

/**
 * Connects the Tourist Portal's existing sign-up form to the real backend:
 * registers an auth account (derived credentials, see deriveTouristCredentials),
 * logs in to obtain a session token, creates the tourist profile with the
 * actual form data, and returns the resulting profile + token so the caller
 * can populate the existing UI without changing its shape.
 */
export async function registerAndLoginTourist(details: {
  fullName: string;
  phone?: string;
  email?: string;
  emergencyContact?: string;
}): Promise<{ token: string; tourist: any } | null> {
  const primaryIdentifier = details.email || details.phone || "guest";
  const { username, password } = deriveTouristCredentials(primaryIdentifier);
  try {
    // full_name/phone_number are sent as part of account creation itself
    // (not a follow-up PATCH) so they're set atomically with the account —
    // a separate PATCH after login is a second network call that can fail,
    // race, or simply not fire, silently leaving full_name defaulted to
    // the account's username/email server-side.
    await registerUser(username, password, "tourist", {
      fullName: details.fullName,
      phoneNumber: details.phone,
    });
  } catch (err: any) {
    // If the derived account already exists (e.g. re-registering the same
    // identifier), fall through to login instead of failing the whole flow.
    if (!(err instanceof ApiError && (err.status === 409 || err.status === 422))) {
      console.error("Tourist registration failed:", err);
      throw err;
    }
  }

  const loginResp = await loginUser(username, password);
  storeSession({
    access_token: loginResp.access_token,
    refresh_token: loginResp.refresh_token,
    user_type: loginResp.user_type,
    tourist_profile_id: loginResp.tourist_profile_id,
    username: loginResp.username,
  });

  if (!loginResp.tourist_profile_id) return null;

  if (details.emergencyContact) {
    const updated = await updateTouristProfile(loginResp.tourist_profile_id, {
      emergency_contacts: [{ name: null, relation: null, phone: details.emergencyContact }],
    });
    return { token: loginResp.access_token, tourist: updated };
  }

  const tourist = await getTouristProfile(loginResp.tourist_profile_id);
  return { token: loginResp.access_token, tourist };
}

/**
 * Connects the Tourist Portal's existing sign-in form (Tourist ID + Phone/Email) to
 * the real backend by attempting a re-login with the same derived credentials
 * used at sign-up time.
 */
export async function loginTouristByPhone(phoneOrEmail: string): Promise<{ token: string; tourist: any } | null> {
  const { username, password } = deriveTouristCredentials(phoneOrEmail);
  try {
    const loginResp = await loginUser(username, password);
    storeSession({
      access_token: loginResp.access_token,
      refresh_token: loginResp.refresh_token,
      user_type: loginResp.user_type,
      tourist_profile_id: loginResp.tourist_profile_id,
      username: loginResp.username,
    });
    if (!loginResp.tourist_profile_id) return null;
    const tourist = await getTouristProfile(loginResp.tourist_profile_id);
    return { token: loginResp.access_token, tourist };
  } catch (err) {
    console.warn("Backend sign-in by phone/email did not match a registered account:", err);
    return null;
  }
}

export async function submitSOSOnline(sosRecord: SOSRecord): Promise<any> {
  const baseUrl = getApiBaseUrl();
  const token = getAuthToken();

  const touristId = sosRecord.tourist_id || getTouristId();

  // Backend requires latitude/longitude (SOSCreate has no default — an SOS
  // with no coordinates at all is not something the dashboard can act on).
  // A last-known-location fallback should already have been applied by the
  // caller (see lib/location.ts getSOSLocation); if we truly have nothing,
  // fail loudly here rather than send a request the server will reject.
  if (sosRecord.latitude == null || sosRecord.longitude == null) {
    throw new ApiError(0, "No location available to send with this SOS. Please enable location and try again.");
  }

  const payload = {
    tourist_id: touristId,
    latitude: sosRecord.latitude,
    longitude: sosRecord.longitude,
    battery_status: sosRecord.battery_status ?? undefined,
    trigger_source: "APP",
  };

  const response = await fetch(`${baseUrl}/sos`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new ApiError(response.status, errText || `Server returned status ${response.status}`);
  }

  return await response.json();
}

export async function syncQueuedSOS(
  onProgressCallback?: (status: string, record: SOSRecord, serverRes?: any) => void
): Promise<{ count: number; synced: number; error?: string }> {
  if (isSyncing) {
    console.log("Sync process already in progress. Skipping duplicate invocation.");
    return { count: 0, synced: 0 };
  }

  if (!navigator.onLine) {
    console.log("Device is offline. Cannot perform synchronization.");
    return { count: 0, synced: 0, error: "Offline" };
  }

  isSyncing = true;
  let syncedCount = 0;
  let queuedRecords: SOSRecord[] = [];

  try {
    queuedRecords = await getQueuedSOSRecords();
    console.log(`Found ${queuedRecords.length} queued offline SOS records to synchronize.`);

    for (const record of queuedRecords) {
      if (record.status === "SYNCED") continue;

      try {
        if (record.local_sos_id) {
          await updateSOSRecordStatus(record.local_sos_id, "SYNCING");
        }

        if (onProgressCallback) onProgressCallback("SYNCING", record);

        const serverResponse = await submitSOSOnline(record);
        console.log("Successfully synchronized SOS record:", serverResponse);

        if (record.local_sos_id) {
          await updateSOSRecordStatus(record.local_sos_id, "SYNCED", {
            server_sos_id: serverResponse.sos_id || `MOCK-${Date.now()}`,
            server_incident_id: serverResponse.incident_id || `MOCK-INC-${Date.now()}`,
          });
        }

        syncedCount++;
        if (onProgressCallback) onProgressCallback("SYNCED", record, serverResponse);
      } catch (err: any) {
        console.error(`Failed to synchronize SOS record ${record.local_sos_id}:`, err);
        if (record.local_sos_id) {
          await updateSOSRecordStatus(record.local_sos_id, "QUEUED_OFFLINE");
        }
        if (onProgressCallback) onProgressCallback("FAILED", record, err);
      }
    }
  } catch (e) {
    console.error("Error during synchronization process:", e);
  } finally {
    isSyncing = false;
  }

  return { count: queuedRecords.length, synced: syncedCount };
}

export interface AIChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Calls the backend's Groq-backed travel assistant. Throws ApiError(503)
 * if no GROQ_API_KEY is configured server-side, or ApiError(502) if Groq
 * itself is unreachable/errors — callers (AskAIPanel) should catch and
 * fall back to the local rule-based assistant rather than surface a raw
 * error, since this is a nice-to-have, not safety-critical.
 */
export async function askTravelAI(message: string, history: AIChatTurn[] = []): Promise<string> {
  const resp = await apiRequest<{ reply: string }>('/ai/chat', {
    method: 'POST',
    auth: false,
    body: { message, history },
  });
  return resp.reply;
}
