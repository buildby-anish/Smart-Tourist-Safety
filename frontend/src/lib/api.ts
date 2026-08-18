const BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '') + '/api/v1';

export interface UserSession {
  auth_id: string;
  username: string;
  user_type: string;
  tourist_id: string | null;
  authority_id: string | null;
  mfa_enabled: boolean;
  last_login_at: string | null;
}

export interface TouristProfile {
  tourist_id: string;
  digital_id: string;
  full_name: string;
  kyc_document_type: string | null;
  kyc_verified: boolean;
  phone: string | null;
  email: string | null;
  emergency_contact: string | null;
  preferred_language: string | null;
  created_at: string;
}

export interface ItineraryEntry {
  itinerary_id: string;
  tourist_id: string;
  location_id: string;
  location_name: string;
  planned_arrival: string | null;
  planned_departure: string | null;
}

export interface IncidentResponse {
  incident_id: string;
  tourist_id: string;
  location_id: string;
  incident_type: string;
  severity: string;
  status: string;
  description: string | null;
  created_at: string;
  sos_status?: string;
}

export interface Alert {
  id: string;
  title: string;
  body: string;
  location: string;
  dist: string;
  time: string;
  severity: 'high' | 'medium' | 'low' | 'info';
  read: boolean;
  type: 'crowd' | 'safety' | 'police' | 'info';
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('suraksha_setu_token');
  const headers = new Headers(options.headers || {});
  
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('X-Session-Token', token);
  }

  const url = `${BASE_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (response.status === 204) {
    return {} as T;
  }

  let data;
  try {
    data = await response.json();
  } catch (e) {
    data = null;
  }

  if (!response.ok) {
    const errorDetail = data?.detail || data?.message || `Request failed with status ${response.status}`;
    throw new Error(typeof errorDetail === 'string' ? errorDetail : JSON.stringify(errorDetail));
  }

  return data as T;
}

export const api = {
  // Auth
  async sendOtp(phone: string): Promise<{ message: string }> {
    return request('/auth/send-otp', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    });
  },

  async verifyOtp(phone: string, otp: string): Promise<{ verified: boolean; message: string }> {
    return request('/auth/verify-otp', {
      method: 'POST',
      body: JSON.stringify({ phone, otp }),
    });
  },

  async register(username: string, phone: string, touristId?: string): Promise<any> {
    return request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username,
        password: phone,
        user_type: 'tourist',
        tourist_id: touristId || null,
        mfa_enabled: false,
      }),
    });
  },

  async login(username: string, phone: string): Promise<{ access_token: string; tourist_id: string & any }> {
    return request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username,
        password: phone,
      }),
    });
  },

  async getSession(): Promise<UserSession> {
    return request('/auth/session', {
      method: 'GET',
    });
  },

  // Tourists
  async getProfile(touristId: string): Promise<TouristProfile> {
    return request(`/tourists/${touristId}`, {
      method: 'GET',
    });
  },

  async updateProfile(touristId: string, data: Partial<TouristProfile>): Promise<TouristProfile> {
    return request(`/tourists/${touristId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  // Itinerary
  async listItinerary(): Promise<ItineraryEntry[]> {
    return request('/itinerary', {
      method: 'GET',
    });
  },

  async createItinerary(data: {
    destination_name: string;
    planned_arrival?: string | null;
    planned_departure?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  }): Promise<ItineraryEntry> {
    return request('/itinerary', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async deleteItinerary(itineraryId: string): Promise<void> {
    return request(`/itinerary/${itineraryId}`, {
      method: 'DELETE',
    });
  },

  // SOS & Incidents
  async triggerSOS(data: {
    tourist_id: string;
    latitude?: number | null;
    longitude?: number | null;
    description?: string | null;
  }): Promise<IncidentResponse> {
    return request('/sos', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async resolveIncident(incidentId: string): Promise<IncidentResponse> {
    return request(`/incidents/${incidentId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'RESOLVED',
      }),
    });
  },

  // Alerts
  async getAlerts(incidentId?: string): Promise<any[]> {
    const query = incidentId ? `?incident_id=${incidentId}` : '';
    return request(`/alerts${query}`, {
      method: 'GET',
    });
  },
};
