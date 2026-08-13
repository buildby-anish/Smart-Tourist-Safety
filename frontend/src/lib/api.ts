import { SOSRecord, getQueuedSOSRecords, updateSOSRecordStatus } from "./db";

let isSyncing = false;

export function getApiBaseUrl(): string {
  return localStorage.getItem("sos_api_base_url") || "http://localhost:8000/api/v1";
}

export function getAuthToken(): string {
  return localStorage.getItem("sos_auth_token") || "";
}

export function getTouristId(): string {
  return localStorage.getItem("sos_tourist_id") || "eee6684b-dee5-4471-bfd0-00b9a7ee9b66";
}

export async function submitSOSOnline(sosRecord: SOSRecord): Promise<any> {
  const baseUrl = getApiBaseUrl();
  const token = getAuthToken();

  const touristId = sosRecord.tourist_id || getTouristId();

  const payload = {
    tourist_id: touristId,
    latitude: sosRecord.latitude !== undefined ? sosRecord.latitude : null,
    longitude: sosRecord.longitude !== undefined ? sosRecord.longitude : null,
    description: sosRecord.description || `SOS Emergency Alert (${sosRecord.location_source || "live"})`,
    severity: sosRecord.severity || "HIGH",
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
    throw new Error(`Server returned status ${response.status}: ${errText}`);
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
