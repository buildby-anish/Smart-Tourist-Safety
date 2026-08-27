import React, { useState, useEffect } from 'react';
import BrandMark from './components/BrandMark';
import {
  Language,
  UserRole,
  ActiveModule,
  TouristProfile,
  SOSIncident,
  PatrollingUnit,
  PoliceStation,
  AnomalyCluster,
  BroadcastAlert,
  AuditLog,
  AILog,
  LiveLocationPing
} from './types';
import {
  INITIAL_TOURISTS,
  INITIAL_INCIDENTS,
  INITIAL_PATROL_UNITS,
  POLICE_STATIONS,
  HOSPITALS,
  ANOMALY_CLUSTERS,
  INITIAL_BROADCASTS,
  INITIAL_AUDIT_LOGS,
  INITIAL_AI_LOGS
} from './data/mockData';
import { i18n } from './data/i18n';
import { Header } from './components/Header';
import { Gateway } from './components/Gateway';
import TouristApp from './components/tourist/TouristApp';
import AuthorityMapApp from './components/authority/AuthorityMapApp';
import {
  authenticateAuthority,
  getAuthorityIncidents,
  getAuthorityTourist,
  getAuthorityIncidentLocation,
  updateIncidentStatus,
  createIncidentResponse,
  createAlert,
  clearSession,
  logoutUser,
  getAuthorityId,
  getUsername,
  createAuditLog,
  listAuditLogs,
  getAuthToken,
  getUserType,
  getTouristId,
  getTouristProfile,
  connectAuthorityFeed,
  getLiveTouristLocations,
  listAuthorityTourists,
  broadcastStateAlert,
  listGeofences,
  deleteIncidents
} from './lib/api';
import LoginModal from './components/tourist/LoginModal';

export default function App() {
  const [language, setLanguage] = useState<Language>('en');
  const [darkMode, setDarkMode] = useState<boolean>(false);

  // Sync dark mode class to root HTML element for Tailwind CSS v4 class-based selector
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);
  // Map-first landing: open straight into the Tourist Portal (map home
  // screen) instead of the old Gateway role-picker/login screen. Gateway
  // (including the real authority MFA login) is still fully intact and
  // reachable via the existing "Gateway" button inside the Tourist Portal
  // panel (onReturnToGateway below) — this only changes what the very
  // first screen is.
  const [userRole, setUserRole] = useState<UserRole>('tourist');
  const [activeModule, setActiveModule] = useState<ActiveModule>('ai_hub');
  const [touristUser, setTouristUser] = useState<any | null>(null);
  const [showLogin, setShowLogin] = useState<boolean>(false);
  const [loginModalMode, setLoginModalMode] = useState<'login' | 'signup'>('login');
  const [loginRole, setLoginRole] = useState<'tourist' | 'authority'>('tourist');
  const [booting, setBooting] = useState<boolean>(true);
  const [splashGone, setSplashGone] = useState<boolean>(false);

  // Master Data State
  const [tourists, setTourists] = useState<TouristProfile[]>([]);
  const [incidents, setIncidents] = useState<SOSIncident[]>([]);
  const [units, setUnits] = useState<PatrollingUnit[]>([]);
  const [stations] = useState<PoliceStation[]>(POLICE_STATIONS);
  const [clusters] = useState<AnomalyCluster[]>([]);
  const [broadcasts, setBroadcasts] = useState<BroadcastAlert[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [aiLogs] = useState<AILog[]>([]);
  // Incrementally updated by location.ping events on the authority socket
  // (see the connectAuthorityFeed effect below) — the authority map does
  // ONE REST call (getLiveTouristLocations) on mount to hydrate initial
  // positions, then relies entirely on this for live updates rather than
  // polling.
  const [liveLocations, setLiveLocations] = useState<Record<string, LiveLocationPing>>({});
  const [geofences, setGeofences] = useState<any[]>([]);

  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [prefilledTouristId, setPrefilledTouristId] = useState('');
  const [authorityAuthError, setAuthorityAuthError] = useState('');

  // Register service worker for offline PWA compliance
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch((err) => {
          console.warn('Service worker registration failed:', err);
        });
      });
    }
  }, []);

  // Restore session at boot time. Keep the splash up briefly so the
  // branded loading screen can display, then fade into the main UI.
  useEffect(() => {
    const started = Date.now();
    const MIN_SPLASH_MS = 700;
    const finishBoot = () => {
      const wait = Math.max(0, MIN_SPLASH_MS - (Date.now() - started));
      window.setTimeout(() => setBooting(false), wait);
    };

    const token = getAuthToken();
    const type = getUserType();

    if (!token) {
      finishBoot();
      return;
    }

    if (type === 'authority') {
      const authId = getAuthorityId();
      if (authId) {
        setUserRole('authority');
        refreshTouristsFromBackend().then((freshTourists) => {
          refreshIncidentsFromBackend(freshTourists);
        });
        refreshAuditLogsFromBackend();
        refreshGeofencesFromBackend();
      }
      finishBoot();
    } else {
      const touristId = getTouristId();
      if (touristId) {
        getTouristProfile(touristId)
          .then((profile) => {
            setTouristUser(profile);
            setUserRole('tourist');
            finishBoot();
          })
          .catch((err) => {
            // Session restore failed (expired/invalid token, or the
            // backend 500'd — e.g. a schema migration for new columns
            // hasn't been applied yet against this database). Explicitly
            // return to the Gateway role-picker rather than leaving
            // userRole at its default 'tourist' value with no user —
            // that stale combination is what made an already-logged-in
            // person land back in the tourist app's auth gate looking
            // like a fresh, unauthenticated visitor.
            console.warn('Session restoration failed:', err);
            clearSession();
            setUserRole('gateway');
            finishBoot();
          });
      } else {
        finishBoot();
      }
    }
  }, []);

  useEffect(() => {
    if (booting) return;
    const id = window.setTimeout(() => setSplashGone(true), 320);
    return () => window.clearTimeout(id);
  }, [booting]);

  // Audit Logging helper — persists to public.audit_logs on the backend
  // (see lib/api.ts createAuditLog) while also updating local state
  // immediately so the UI doesn't wait on the network round-trip. Uses the
  // actual signed-in authority's identity instead of a hardcoded officer.
  const handleLogAudit = (
    actionType: 'TOURIST_LOOKUP' | 'DISPATCH_UNIT' | 'BROADCAST_SENT' | 'TICKET_STATUS_CHANGE' | 'AUTHORITY_LOGIN',
    targetId: string,
    reason: string,
    details: string
  ) => {
    const officerBadge = getUsername() || 'Unknown Officer';
    const localId = `AUD-${Math.floor(1000 + Math.random() * 9000)}`;
    const newLog: AuditLog = {
      id: localId,
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
      officerName: officerBadge,
      officerBadge,
      actionType,
      targetId,
      reason,
      details,
      ipAddress: 'Client-reported (see server audit log for source IP)'
    };
    setAuditLogs((prev) => [newLog, ...prev]);

    createAuditLog({
      action_type: actionType,
      target_id: targetId,
      reason,
      details
    })
      .then((saved) => {
        if (saved?.audit_id) {
          setAuditLogs((prev) =>
            prev.map((l) => (l.id === localId ? { ...l, backendAuditId: saved.audit_id } : l))
          );
        }
      })
      .catch((err) => {
        console.warn('Failed to persist audit log to backend:', err);
      });
  };

  // Pull persisted audit log entries from the backend and merge them with
  // any local-only entries not yet confirmed as saved.
  const refreshAuditLogsFromBackend = async () => {
    try {
      const backendLogs = await listAuditLogs();
      const mapped: AuditLog[] = backendLogs.map((log: any) => ({
        id: `BE-${log.audit_id}`,
        backendAuditId: log.audit_id,
        timestamp: log.created_at
          ? new Date(log.created_at).toISOString().replace('T', ' ').substring(0, 19)
          : new Date().toISOString().replace('T', ' ').substring(0, 19),
        officerName: getUsername() || 'Officer',
        officerBadge: getUsername() || 'Officer',
        actionType: log.action_type,
        targetId: log.target_id,
        reason: log.reason,
        details: log.details || '',
        ipAddress: log.ip_address || 'Server-recorded'
      }));

      setAuditLogs((prev) => {
        const backendIds = new Set(mapped.map((m) => m.backendAuditId));
        const localOnly = prev.filter((p) => !p.backendAuditId || !backendIds.has(p.backendAuditId));
        return [...mapped, ...localOnly];
      });
    } catch (err) {
      console.warn('Failed to refresh audit logs from backend:', err);
    }
  };

  // Map a backend incident status onto the existing local SOSStatus enum.
  const mapBackendStatus = (status: string): SOSIncident['status'] => {
    const s = (status || '').toUpperCase();
    if (s === 'RESOLVED' || s === 'CLOSED') return 'Resolved';
    if (s === 'INVESTIGATING') return 'Units Dispatched';
    return 'New';
  };

  const mapBackendPriority = (priority: string | null | undefined): SOSIncident['severity'] => {
    const s = (priority || '').toUpperCase();
    if (s === 'CRITICAL' || s === 'HIGH') return 'Critical';
    if (s === 'MEDIUM') return 'Warning';
    return 'Advisory';
  };

  // Pull real incidents (created via the Tourist Portal's SOS/incident flows)
  // from the backend and merge them into the existing local incidents state,
  // resolving tourist and location details on a best-effort basis so the
  // existing Kanban/Map UI can render them without any structural changes.
  const refreshIncidentsFromBackend = async (currentTouristsList?: TouristProfile[]) => {
    try {
      const backendIncidents = await getAuthorityIncidents();
      const activeTourists = currentTouristsList || tourists;
      const mapped: SOSIncident[] = backendIncidents.map((inc: any) => {
        let touristName = 'Registered Tourist';
        let touristPhone = '';
        const localTourist = activeTourists.find((t) => t.tourist_id === inc.tourist_id || t.id === inc.tourist_id);
        if (localTourist) {
          touristName = localTourist.full_name || localTourist.name;
          touristPhone = localTourist.phone;
        } else {
          console.log(`[Incident Refresh] tourist lookup starting for inc: ${inc.id}, tourist_id: ${inc.tourist_id}`);
          getAuthorityTourist(inc.tourist_id).then((backendTourist) => {
            console.log(`[Incident Refresh] resolved backend tourist details for ${inc.tourist_id}:`, backendTourist);
            if (backendTourist) {
              const name = backendTourist.full_name || backendTourist.name || 'Registered Tourist';
              const phone = backendTourist.phone_number || '';
              setIncidents((prev) =>
                prev.map((item) =>
                  item.backendIncidentId === inc.id
                    ? { ...item, touristName: name, touristPhone: phone }
                    : item
                )
              );
            }
          }).catch((err) => {
            console.error(`[Incident Refresh] failed background lookup for ${inc.tourist_id}:`, err);
          });
        }

        // Incidents carry their own latitude/longitude directly now (directive §4)
        const lat = inc.latitude ?? 32.2432;
        const lng = inc.longitude ?? 77.1892;
        const address = inc.description || `${inc.incident_type || 'Incident'} report`;

        const result: SOSIncident = {
          id: `BE-${inc.id}`,
          backendIncidentId: inc.id,
          touristId: inc.tourist_id,
          touristName,
          touristPhone,
          location: { lat, lng, address },
          timestamp: inc.created_at
            ? new Date(inc.created_at).toISOString().replace('T', ' ').substring(0, 19)
            : new Date().toISOString().replace('T', ' ').substring(0, 19),
          status: mapBackendStatus(inc.status),
          severity: mapBackendPriority(inc.priority),
          hazardType: inc.incident_type || 'OTHER',
          notes: inc.description || 'Incident synced from backend.',
          aiRiskScore: inc.ai_risk_score ?? undefined,
        };
        return result;
      });

      setIncidents(mapped);
    } catch (err) {
      console.warn('Failed to refresh incidents from backend:', err);
    }
  };

  const refreshTouristsFromBackend = async () => {
    try {
      const [backendTourists, livePings] = await Promise.all([
        listAuthorityTourists(),
        getLiveTouristLocations()
      ]);

      const pingMap: Record<string, any> = {};
      for (const ping of livePings) {
        pingMap[ping.tourist_id] = ping;
      }

      const mapped: TouristProfile[] = backendTourists.map((t: any) => {
        const ping = pingMap[t.id] || pingMap[t.tourist_id];
        return {
          id: t.id,
          tourist_id: t.tourist_id || t.id,
          name: t.full_name,
          full_name: t.full_name,
          nationality: t.preferred_language || 'India',
          passportHash: t.govt_id_number ? `${t.govt_id_type}: ${t.govt_id_number}` : 'N/A',
          phone: t.phone_number || '',
          email: t.email || '',
          emergencyContact: t.emergency_contacts?.[0]?.phone || '',
          emergencyRelation: t.emergency_contacts?.[0]?.relationship || '',
          hotel: 'N/A',
          batteryLevel: 100,
          safetyStatus: t.kyc_status === 'VERIFIED' ? 'Safe' : 'Watch',
          lastSeenTime: ping ? 'Online' : 'Offline',
          currentLocation: ping ? {
            lat: ping.latitude,
            lng: ping.longitude,
            address: 'Live Location',
          } : undefined,
          kyc_verified: t.kyc_status === 'VERIFIED',
        };
      });
      setTourists(mapped);
      return mapped;
    } catch (err) {
      console.warn('Failed to refresh tourists from backend:', err);
      return [];
    }
  };

  const refreshGeofencesFromBackend = async () => {
    try {
      const list = await listGeofences(false);
      setGeofences(list);
    } catch (err) {
      console.warn('Failed to refresh geofences from backend:', err);
    }
  };

  // Realtime authority feed (directive §B.1, §B.3, §B.2): connects once the
  // dashboard is authenticated as an authority, and refreshes incidents the
  // moment the backend pushes an sos.created / incident.updated /
  // incident.deleted / geofence.breach event, instead of relying solely on
  // manual refresh calls. incident.deleted is what makes bulk-delete from
  // one authority screen disappear on every other connected authority
  // session immediately, instead of only on their next manual refresh.
  useEffect(() => {
    if (userRole !== 'authority') return;
    const socket = connectAuthorityFeed((event) => {
      if (
        event.type === 'sos.created' ||
        event.type === 'incident.updated' ||
        event.type === 'incident.deleted' ||
        event.type === 'geofence.breach' ||
        event.type === 'tourist.updated'
      ) {
        refreshTouristsFromBackend().then((freshTourists) => {
          refreshIncidentsFromBackend(freshTourists);
        });
      } else if (
        event.type === 'geofence.created' ||
        event.type === 'geofence.updated' ||
        event.type === 'geofence.deleted'
      ) {
        // Backend now broadcasts these on every geofence create/update/
        // delete (see routers/geofences.py), so a zone removed on one
        // authority screen disappears everywhere immediately instead of
        // waiting for the 15s poll below.
        refreshGeofencesFromBackend();
      } else if (event.type === 'location.ping' && event.data?.tourist_id) {
        setLiveLocations((prev) => ({ ...prev, [event.data.tourist_id]: event.data }));
      }
    });
    return () => socket?.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userRole]);

  // Dual-side geofence sync: the tourist map already polls listGeofences
  // every 15s (see MapCanvas), so a zone drawn by an authority officer
  // shows up for tourists automatically. The authority dashboard itself,
  // though, only ever refetched geofences at login and right after its own
  // create/update/delete actions — so a zone created/removed from a
  // *different* authority session (or before this dashboard's DB pool
  // exhaustion issue was fixed — see db.py — silently failed to load) never
  // showed up here, which is exactly what made it look "undeletable."
  // Poll on the same cadence as the tourist side so both stay in sync.
  useEffect(() => {
    if (userRole !== 'authority') return;
    const intervalId = window.setInterval(() => {
      refreshGeofencesFromBackend();
    }, 15000);
    return () => window.clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userRole]);

  // Authority MFA Authenticate — backed by the real /authority/login
  // endpoint (see lib/api.ts authenticateAuthority for the credential
  // mapping). Login fails outright for a badge that isn't registered —
  // there is no auto-registration fallback.
  const handleAuthenticateAuthority = async (badgeId: string, otp: string): Promise<boolean> => {
    setAuthorityAuthError('');
    const result = await authenticateAuthority(badgeId, otp);
    if (!result) {
      setAuthorityAuthError('Authentication failed.');
      return false;
    }

    setUserRole('authority');
    setActiveModule('ai_hub');
    handleLogAudit(
      'AUTHORITY_LOGIN',
      `Officer ${badgeId}`,
      'MFA Verification',
      'Successful 2FA login to National Command Center'
    );

    refreshTouristsFromBackend().then((freshTourists) => {
      refreshIncidentsFromBackend(freshTourists);
    });
    refreshAuditLogsFromBackend();
    refreshGeofencesFromBackend();

    return true;
  };

  const handleLogout = async () => {
    try {
      await logoutUser();
    } catch (err) {
      console.warn('Backend logout failed:', err);
    }
    clearSession();
    setTouristUser(null);
    setUserRole('tourist');
  };

  const handleAuthenticated = (role: 'tourist' | 'authority', user: any) => {
    setShowLogin(false);
    if (role === 'authority') {
      setUserRole('authority');
      setActiveModule('ai_hub');
      handleLogAudit(
        'AUTHORITY_LOGIN',
        `Officer ${user.username}`,
        'MFA Verification',
        'Successful 2FA login to National Command Center'
      );
      refreshTouristsFromBackend().then((freshTourists) => {
        refreshIncidentsFromBackend(freshTourists);
      });
      refreshAuditLogsFromBackend();
    } else {
      setTouristUser(user);
      setUserRole('tourist');
    }
  };

  // Global search trigger
  const handleExecuteGlobalSearch = () => {
    if (!globalSearchQuery.trim()) return;
    setPrefilledTouristId(globalSearchQuery.trim());
    setActiveModule('tourist_tracking');
  };

  // Trigger SOS from Tourist Portal
  const handleTouristTriggerSos = (touristName: string, locationStr: string, touristId?: string, touristPhone?: string) => {
    const resolvedTouristId = touristId || 'UNKNOWN';
    const newIncident: SOSIncident = {
      id: `SOS-${Math.floor(9000 + Math.random() * 999)}`,
      touristId: resolvedTouristId,
      touristName,
      touristPhone: touristPhone || '',
      location: {
        lat: 32.2432,
        lng: 77.1892,
        address: locationStr
      },
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
      status: 'New',
      severity: 'Critical',
      hazardType: '1-Tap Emergency Panic Button Press',
      notes: 'Direct panic beacon press from tourist mobile safety portal.'
    };

    setIncidents((prev) => [newIncident, ...prev]);
    
    // Update tourist safety status
    setTourists((prev) =>
      prev.map((t) =>
        t.id === resolvedTouristId ? { ...t, safetyStatus: 'SOS Active' } : t
      )
    );

    handleLogAudit(
      'TICKET_STATUS_CHANGE',
      newIncident.id,
      'Active SOS Response',
      `New panic signal received from ${touristName} at ${locationStr}`
    );
  };

  // Dispatch Responder Unit
  const handleDispatchUnit = async (incidentId: string, unitId: string) => {
    const targetUnit = units.find((u) => u.id === unitId);
    const targetIncident = incidents.find((i) => i.id === incidentId);

    if (!targetIncident) return;

    // Update incident status
    setIncidents((prev) =>
      prev.map((i) =>
        i.id === incidentId
          ? { ...i, status: 'Units Dispatched', unitAssigned: targetUnit?.unitName || unitId }
          : i
      )
    );

    // Update unit status
    if (targetUnit) {
      setUnits((prev) =>
        prev.map((u) =>
          u.id === unitId ? { ...u, status: 'Dispatched', assignedIncidentId: incidentId } : u
        )
      );
    }

    // If this incident has a real backend counterpart, persist the status
    // change via PATCH /api/v1/incidents/{incident_id}. The backend
    // auto-assigns assigned_officer_id from the caller's session on this
    // status transition (see routers/incidents.py update_incident), so no
    // explicit officer id needs to be sent here — sending status alone is
    // enough to both dispatch and claim the incident.
    if (targetIncident.backendIncidentId) {
      try {
        await updateIncidentStatus(targetIncident.backendIncidentId, { status: 'INVESTIGATING' });
      } catch (err) {
        console.warn('Failed to persist dispatch status to backend:', err);
      }
      try {
        const authorityId = getAuthorityId();
        await createIncidentResponse(targetIncident.backendIncidentId, {
          responder_unit: targetUnit?.unitName || unitId,
          action_taken: `Unit ${targetUnit?.unitName || unitId} dispatched to incident.`,
          ...(authorityId ? { authority_id: authorityId } : {})
        });
      } catch (err) {
        console.warn('Failed to log dispatch response to backend:', err);
      }
    }

    handleLogAudit(
      'DISPATCH_UNIT',
      unitId,
      'Active SOS Response',
      `Dispatched unit ${targetUnit?.unitName || unitId} to SOS Incident ${incidentId}`
    );
  };

  // Resolve Incident
  const handleResolveIncident = async (incidentId: string) => {
    const targetIncident = incidents.find((i) => i.id === incidentId);

    setIncidents((prev) =>
      prev.map((i) => (i.id === incidentId ? { ...i, status: 'Resolved' } : i))
    );

    if (targetIncident) {
      setTourists((prev) =>
        prev.map((t) =>
          t.id === targetIncident.touristId ? { ...t, safetyStatus: 'Safe' } : t
        )
      );
    }

    if (targetIncident?.backendIncidentId) {
      try {
        await updateIncidentStatus(targetIncident.backendIncidentId, { status: 'RESOLVED' });
      } catch (err) {
        console.warn('Failed to persist resolution status to backend:', err);
      }
    }

    handleLogAudit(
      'TICKET_STATUS_CHANGE',
      incidentId,
      'Incident Resolution',
      `Marked SOS Incident ${incidentId} as Resolved. Tourist confirmed safe.`
    );
  };

  // Bulk-delete incidents — powers the authority dashboard's "select all
  // SOS + delete" action. Removes them from local state immediately, then
  // persists the delete for every incident that has a real backend id.
  // Other connected authority sessions pick up the delete via the
  // "incident.deleted" realtime event handled in the socket effect below,
  // rather than only on their next manual refresh — the other half of
  // keeping tourist/authority state in sync both ways.
  const handleDeleteIncidents = async (incidentIds: string[]) => {
    const idSet = new Set(incidentIds);
    const targets = incidents.filter((i) => idSet.has(i.id));
    const backendIds = targets.map((i) => i.backendIncidentId).filter(Boolean) as string[];

    setIncidents((prev) => prev.filter((i) => !idSet.has(i.id)));

    if (backendIds.length === 0) return;
    try {
      await deleteIncidents(backendIds);
    } catch (err) {
      console.warn('Failed to delete incidents on backend:', err);
      // Re-sync with the backend rather than leaving local/remote state
      // silently diverged if the bulk delete failed server-side.
      const fresh = await refreshTouristsFromBackend();
      await refreshIncidentsFromBackend(fresh);
    }
  };

  // Mark tourist safe from the Tourist Tracking module — resolves that
  // tourist's most recent open backend incident (if any) via PATCH, mirroring
  // handleResolveIncident above.
  const handleMarkTouristSafe = async (touristId: string) => {
    setTourists((prev) =>
      prev.map((t) => (t.id === touristId ? { ...t, safetyStatus: 'Safe' } : t))
    );

    const openIncident = incidents.find(
      (i) => i.touristId === touristId && i.status !== 'Resolved' && i.backendIncidentId
    );
    if (openIncident?.backendIncidentId) {
      setIncidents((prev) =>
        prev.map((i) => (i.id === openIncident.id ? { ...i, status: 'Resolved' } : i))
      );
      try {
        await updateIncidentStatus(openIncident.backendIncidentId, { status: 'RESOLVED' });
      } catch (err) {
        console.warn('Failed to persist mark-safe resolution to backend:', err);
      }
    }
  };

  // Send Broadcast Alert
  const handleSendBroadcast = (
    newAlert: Omit<BroadcastAlert, 'id' | 'timestamp' | 'deliveredCount' | 'status'>
  ) => {
    const createdAlert: BroadcastAlert = {
      ...newAlert,
      id: `BC-${Math.floor(500 + Math.random() * 500)}`,
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
      deliveredCount: Math.round(newAlert.recipientCount * 0.98),
      status: 'Completed'
    };

    setBroadcasts((prev) => [createdAlert, ...prev]);

    // Call backend API to broadcast alert to tourists in selected state/region
    broadcastStateAlert({
      state: newAlert.region,
      message: `${newAlert.titleEn}: ${newAlert.bodyEn}`,
      severity: newAlert.severity.toUpperCase(),
    }).then((res) => {
      console.log('State alert broadcast sent successfully:', res);
    }).catch((err) => {
      console.warn('Failed to send backend state alert:', err);
    });

    // The backend's `alerts` table models a notification tied to one
    // incident + one recipient/channel — there is no backend concept of a
    // region-wide broadcast campaign (see DATABASE.md §5.7). As the closest
    // faithful mapping without inventing new backend behavior, publishing a
    // broadcast also logs a real SMS alert record against every currently
    // active backend-linked incident. This is best-effort and non-blocking;
    // the existing local broadcast history/UI is unaffected either way.
    incidents
      .filter((i) => i.status !== 'Resolved' && i.backendIncidentId)
      .forEach((i) => {
        createAlert({
          incident_id: i.backendIncidentId as string,
          channel: 'SMS',
          recipient: newAlert.region
        }).catch((err) => console.warn('Failed to log backend alert for broadcast:', err));
      });

    handleLogAudit(
      'BROADCAST_SENT',
      `Geofence ${newAlert.region}`,
      'Emergency Hazard Alert',
      `Pushed ${newAlert.severity} alert to ~${newAlert.recipientCount} active tourist devices.`
    );
  };

  // Add mock SOS trigger for testing
  const handleAddMockSos = () => {
    const randomTourist = tourists[Math.floor(Math.random() * tourists.length)];
    const newInc: SOSIncident = {
      id: `SOS-${Math.floor(9100 + Math.random() * 899)}`,
      touristId: randomTourist.id,
      touristName: randomTourist.name,
      touristPhone: randomTourist.phone,
      location: randomTourist.currentLocation,
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
      status: 'New',
      severity: 'Critical',
      hazardType: 'Simulated High Altitude Signal Anomaly',
      notes: 'Continuous panic signal generated via test control console.'
    };

    setIncidents((prev) => [newInc, ...prev]);
    setTourists((prev) =>
      prev.map((t) => (t.id === randomTourist.id ? { ...t, safetyStatus: 'SOS Active' } : t))
    );

    handleLogAudit(
      'TICKET_STATUS_CHANGE',
      newInc.id,
      'Active SOS Response',
      `Simulated SOS incident created for ${randomTourist.name}`
    );
  };

  const activeSosCount = incidents.filter((i) => i.status !== 'Resolved').length;

  return (
    <div className={`h-full w-full overflow-hidden ${darkMode ? 'bg-slate-950 text-slate-100' : 'bg-[#F4F6F9] text-slate-900'} flex flex-col font-sans transition-colors duration-200`}>
      {!splashGone && (
        <div
          className={`fixed inset-0 z-[100] flex flex-col items-center justify-center ${
            darkMode ? 'bg-[#1e1e1e]' : 'bg-white'
          } transition-opacity duration-300 ${
            booting ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          aria-hidden={!booting}
          aria-busy={booting}
        >
          <div className="relative flex items-center justify-center">
            <span className="splash-ring" />
            <BrandMark size={72} className="splash-mark relative z-10" />
          </div>
          <div className="mt-6 h-0.5 w-16 flex overflow-hidden rounded-full">
            <div className="h-full w-1/3 bg-[#FF9933]" />
            <div className="h-full w-1/3 bg-white" />
            <div className="h-full w-1/3 bg-[#138808]" />
          </div>
        </div>
      )}

      
      {/* Command Header — the authority role now renders its own
          full-screen AuthorityHeader (see AuthorityMapApp below) instead
          of this bar; still used for the Gateway role-picker screen. */}
      {userRole !== 'tourist' && userRole !== 'authority' && (
        <Header
          language={language}
          onLanguageChange={setLanguage}
          darkMode={darkMode}
          onToggleDarkMode={() => setDarkMode(!darkMode)}
          userRole={userRole}
          onLogout={handleLogout}
          onLogoClick={() => setUserRole('tourist')}
          activeModule={activeModule}
          onSelectModule={setActiveModule}
          globalSearchQuery={globalSearchQuery}
          onGlobalSearchChange={setGlobalSearchQuery}
          onExecuteGlobalSearch={handleExecuteGlobalSearch}
          activeSosCount={activeSosCount}
          isAuthenticatedTourist={!!touristUser}
          touristName={touristUser?.full_name || touristUser?.name || null}
          onLoginClick={() => { setLoginModalMode('login'); setLoginRole('tourist'); setShowLogin(true); }}
          onSignUpClick={() => { setLoginModalMode('signup'); setLoginRole('tourist'); setShowLogin(true); }}
        />
      )}

      {/* Main Content Area */}
      {userRole === 'gateway' ? (
        <Gateway
          language={language}
          onSelectRole={(role) => setUserRole(role)}
          onAuthenticateAuthority={handleAuthenticateAuthority}
        />
      ) : userRole === 'tourist' ? (
        <TouristApp
          darkMode={darkMode}
          onToggleDarkMode={() => setDarkMode(!darkMode)}
          onTriggerSos={handleTouristTriggerSos}
          onReturnToGateway={() => {
            setLoginRole('authority');
            setShowLogin(true);
          }}
          user={touristUser}
          setUser={setTouristUser}
          showLogin={showLogin}
          setShowLogin={(show) => {
            if (show) setLoginRole('tourist');
            setShowLogin(show);
          }}
          onLogout={handleLogout}
          language={language}
          onLanguageChange={setLanguage}
          booting={booting}
        />
      ) : (
        <AuthorityMapApp
          language={language}
          onLanguageChange={setLanguage}
          darkMode={darkMode}
          onToggleDarkMode={() => setDarkMode(!darkMode)}
          onLogout={handleLogout}
          officerName={getUsername() || i18n[language].officerName}
          tourists={tourists}
          incidents={incidents}
          units={units}
          stations={stations}
          hospitals={HOSPITALS}
          clusters={clusters}
          auditLogs={auditLogs}
          liveLocations={liveLocations}
          geofences={geofences}
          onGeofenceCreated={refreshGeofencesFromBackend}
          onDispatchUnit={handleDispatchUnit}
          onResolveIncident={handleResolveIncident}
          onDeleteIncidents={handleDeleteIncidents}
          onMarkTouristSafe={handleMarkTouristSafe}
          onSendBroadcast={handleSendBroadcast}
        />
      )}

      {showLogin && (
        <LoginModal
          darkMode={darkMode}
          initialMode={loginModalMode}
          onClose={() => setShowLogin(false)}
          onAuthenticated={handleAuthenticated}
          dismissable={!(userRole === 'tourist' && !touristUser)}
          // Opened from inside the tourist app's own auth gate -> we
          // already know the context is "tourist," so skip the redundant
          // "tourist or authority?" prompt on every sign-in. Only the
          // general-purpose Gateway entry point (userRole === 'gateway')
          // leaves the role genuinely open.
          lockedRole={touristUser ? 'tourist' : loginRole === 'authority' ? 'authority' : undefined}
        />
      )}

    </div>
  );
}
