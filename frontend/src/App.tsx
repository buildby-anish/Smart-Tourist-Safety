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
  AILog
} from './types';
import {
  INITIAL_TOURISTS,
  INITIAL_INCIDENTS,
  INITIAL_PATROL_UNITS,
  POLICE_STATIONS,
  ANOMALY_CLUSTERS,
  INITIAL_BROADCASTS,
  INITIAL_AUDIT_LOGS,
  INITIAL_AI_LOGS
} from './data/mockData';
import { Header } from './components/Header';
import { Gateway } from './components/Gateway';
import TouristApp from './components/tourist/TouristApp';
import { ModuleAIHub } from './components/ModuleAIHub';
import { ModuleTouristTracking } from './components/ModuleTouristTracking';
import { ModuleSOSMap } from './components/ModuleSOSMap';
import { ModuleBroadcast } from './components/ModuleBroadcast';
import { ModuleAnalyticsAudit } from './components/ModuleAnalyticsAudit';
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
  connectAuthorityFeed
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
  const [booting, setBooting] = useState<boolean>(true);
  const [splashGone, setSplashGone] = useState<boolean>(false);

  // Master Data State
  const [tourists, setTourists] = useState<TouristProfile[]>(INITIAL_TOURISTS);
  const [incidents, setIncidents] = useState<SOSIncident[]>(INITIAL_INCIDENTS);
  const [units, setUnits] = useState<PatrollingUnit[]>(INITIAL_PATROL_UNITS);
  const [stations] = useState<PoliceStation[]>(POLICE_STATIONS);
  const [clusters] = useState<AnomalyCluster[]>(ANOMALY_CLUSTERS);
  const [broadcasts, setBroadcasts] = useState<BroadcastAlert[]>(INITIAL_BROADCASTS);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(INITIAL_AUDIT_LOGS);
  const [aiLogs] = useState<AILog[]>(INITIAL_AI_LOGS);

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
        refreshIncidentsFromBackend();
        refreshAuditLogsFromBackend();
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
            console.warn('Session restoration failed:', err);
            clearSession();
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
  const refreshIncidentsFromBackend = async () => {
    try {
      const backendIncidents = await getAuthorityIncidents();
      const mapped: SOSIncident[] = await Promise.all(
        backendIncidents.map(async (inc: any) => {
          let touristName = 'Registered Tourist';
          let touristPhone = '';
          const localTourist = tourists.find((t) => t.tourist_id === inc.tourist_id);
          if (localTourist) {
            touristName = localTourist.full_name || localTourist.name;
            touristPhone = localTourist.phone;
          } else {
            try {
              const backendTourist = await getAuthorityTourist(inc.tourist_id);
              touristName = backendTourist.full_name || touristName;
              touristPhone = backendTourist.phone_number || '';
            } catch (e) {
              // Tourist lookup failed (e.g. RLS/not found) — keep placeholder.
            }
          }

          // Incidents carry their own latitude/longitude directly now
          // (directive §4) — no separate location-name lookup, so the
          // "address" shown is the incident's own description text.
          let lat = 32.2432;
          let lng = 77.1892;
          const address = inc.description || `${inc.incident_type || 'Incident'} report`;
          try {
            const loc = await getAuthorityIncidentLocation(inc.id);
            if (loc.latitude != null) lat = loc.latitude;
            if (loc.longitude != null) lng = loc.longitude;
          } catch (e) {
            // Location lookup failed — keep defaults.
          }

          const result: SOSIncident = {
            id: `BE-${inc.id}`,
            backendIncidentId: inc.id,
            touristId: localTourist?.id || inc.tourist_id,
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
        })
      );

      setIncidents((prev) => {
        const backendIds = new Set(mapped.map((m) => m.backendIncidentId));
        const localOnly = prev.filter((p) => !p.backendIncidentId || !backendIds.has(p.backendIncidentId));
        return [...mapped, ...localOnly];
      });
    } catch (err) {
      console.warn('Failed to refresh incidents from backend:', err);
    }
  };

  // Realtime authority feed (directive §B.1, §B.3, §B.2): connects once the
  // dashboard is authenticated as an authority, and refreshes incidents the
  // moment the backend pushes an sos.created / incident.updated /
  // geofence.breach event, instead of relying solely on manual refresh calls.
  useEffect(() => {
    if (userRole !== 'authority') return;
    const socket = connectAuthorityFeed((event) => {
      if (event.type === 'sos.created' || event.type === 'incident.updated' || event.type === 'geofence.breach') {
        refreshIncidentsFromBackend();
      }
    });
    return () => socket?.close();
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

    // Populate the dashboard with real backend incidents (in addition to the
    // existing local demo data) now that we have an authenticated session.
    refreshIncidentsFromBackend();
    refreshAuditLogsFromBackend();

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
      refreshIncidentsFromBackend();
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
          className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#0C2340] transition-opacity duration-300 ${
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

      
      {/* Command Header */}
      {userRole !== 'tourist' && (
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
          onLoginClick={() => { setLoginModalMode('login'); setShowLogin(true); }}
          onSignUpClick={() => { setLoginModalMode('signup'); setShowLogin(true); }}
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
          onReturnToGateway={() => setUserRole('gateway')}
          user={touristUser}
          setUser={setTouristUser}
          showLogin={showLogin}
          setShowLogin={setShowLogin}
          onLogout={handleLogout}
          language={language}
          onLanguageChange={setLanguage}
        />
      ) : (
        <div className="flex-1 flex flex-col max-w-[1700px] w-full mx-auto">
          
          {/* Module Screen Content */}
          <main className="flex-1 p-4 sm:p-6 overflow-y-auto">
            {activeModule === 'ai_hub' && (
              <ModuleAIHub
                language={language}
                clusters={clusters}
                aiLogs={aiLogs}
                onInvestigateCluster={(cluster) => {
                  setPrefilledTouristId('TR-88219');
                  setActiveModule('tourist_tracking');
                }}
                onNavigateToMap={() => setActiveModule('sos_map')}
              />
            )}

            {activeModule === 'tourist_tracking' && (
              <ModuleTouristTracking
                language={language}
                tourists={tourists}
                onLogAudit={handleLogAudit}
                onDispatchToTourist={(tourist) => {
                  setActiveModule('sos_map');
                }}
                onSendSmsToTourist={(tourist) => {
                  setActiveModule('broadcast');
                }}
                onMarkSafe={handleMarkTouristSafe}
                prefilledTouristId={prefilledTouristId}
              />
            )}

            {activeModule === 'sos_map' && (
              <ModuleSOSMap
                language={language}
                incidents={incidents}
                units={units}
                stations={stations}
                onDispatchUnit={handleDispatchUnit}
                onResolveIncident={handleResolveIncident}
                onAddMockSos={handleAddMockSos}
              />
            )}

            {activeModule === 'broadcast' && (
              <ModuleBroadcast
                language={language}
                broadcasts={broadcasts}
                onSendBroadcast={handleSendBroadcast}
              />
            )}

            {activeModule === 'analytics_audit' && (
              <ModuleAnalyticsAudit
                language={language}
                auditLogs={auditLogs}
              />
            )}
          </main>

        </div>
      )}

      {showLogin && (
        <LoginModal
          darkMode={darkMode}
          initialMode={loginModalMode}
          onClose={() => setShowLogin(false)}
          onAuthenticated={handleAuthenticated}
          dismissable={!(userRole === 'tourist' && !touristUser)}
        />
      )}

    </div>
  );
}
