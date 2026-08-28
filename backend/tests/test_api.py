import os
import sys
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient

# Ensure backend root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.dirname(os.path.dirname(__file__))))

from main import app

client = TestClient(app)

@pytest.fixture
def auth_headers_tourist():
    # Register tourist
    username = f"tourist_{uuid4().hex[:6]}"
    reg_payload = {
        "username": username,
        "password": "Password123!",
        "user_type": "tourist",
        "mfa_enabled": False
    }
    reg_resp = client.post("/api/v1/auth/register", json=reg_payload)
    assert reg_resp.status_code == 201
    
    # Login tourist
    login_resp = client.post("/api/v1/auth/login", json={
        "username": username,
        "password": "Password123!"
    })
    assert login_resp.status_code == 200
    token = login_resp.json()["access_token"]
    tourist_id = login_resp.json()["tourist_profile_id"]
    return {
        "Authorization": f"Bearer {token}",
        "tourist_id": tourist_id,
        "username": username
    }

@pytest.fixture
def auth_headers_authority():
    # Register authority
    username = f"auth_{uuid4().hex[:6]}"
    reg_payload = {
        "username": username,
        "password": "Password123!",
        "user_type": "authority",
        "mfa_enabled": False
    }
    reg_resp = client.post("/api/v1/auth/register", json=reg_payload)
    assert reg_resp.status_code == 201
    
    # Login authority
    login_resp = client.post("/api/v1/auth/login", json={
        "username": username,
        "password": "Password123!"
    })
    assert login_resp.status_code == 200
    token = login_resp.json()["access_token"]
    authority_id = login_resp.json()["authority_id"]
    return {
        "Authorization": f"Bearer {token}",
        "authority_id": authority_id,
        "username": username
    }

def test_auth_flows(auth_headers_tourist):
    headers = {"Authorization": auth_headers_tourist["Authorization"]}
    session_resp = client.get("/api/v1/auth/session", headers=headers)
    assert session_resp.status_code == 200
    assert session_resp.json()["username"] == auth_headers_tourist["username"]
    assert session_resp.json()["user_type"] == "tourist"

def test_tourist_profile(auth_headers_tourist):
    headers = {"Authorization": auth_headers_tourist["Authorization"]}
    tourist_id = auth_headers_tourist["tourist_id"]
    
    # Retrieve profile
    get_resp = client.get(f"/api/v1/tourists/{tourist_id}", headers=headers)
    assert get_resp.status_code == 200
    
    # Get digital ID
    did_resp = client.get(f"/api/v1/tourists/{tourist_id}/digital-id", headers=headers)
    assert did_resp.status_code == 200
    assert "tourist_id" in did_resp.json()
    
    # Update profile
    patch_resp = client.patch(f"/api/v1/tourists/{tourist_id}", headers=headers, json={
        "full_name": "Updated Full Name",
        "phone_number": "+1234567890",
        "emergency_contacts": [{"name": "Emergency Contact Info", "phone": "+1234567890"}]
    })
    assert patch_resp.status_code == 200
    assert patch_resp.json()["full_name"] == "Updated Full Name"
    assert patch_resp.json()["phone_number"] == "+1234567890"

def test_incident_flows(auth_headers_tourist, auth_headers_authority):
    t_headers = {"Authorization": auth_headers_tourist["Authorization"]}
    a_headers = {"Authorization": auth_headers_authority["Authorization"]}
    tourist_id = auth_headers_tourist["tourist_id"]
    
    # 1. Create location first
    location_id = str(uuid4())
    
    # 2. Create incident
    inc_payload = {
        "tourist_id": tourist_id,
        "incident_type": "MANUAL",
        "priority": "HIGH",
        "status": "OPEN",
        "description": "Stolen backpack at monument"
    }
    
    create_resp = client.post("/api/v1/incidents", json=inc_payload, headers=t_headers)
    assert create_resp.status_code == 201
    incident_id = create_resp.json()["id"]
    
    # 3. Retrieve incident
    get_resp = client.get(f"/api/v1/incidents/{incident_id}", headers=t_headers)
    assert get_resp.status_code == 200
    assert get_resp.json()["description"] == "Stolen backpack at monument"
    
    # 4. List incidents
    list_resp = client.get("/api/v1/incidents", headers=t_headers)
    assert list_resp.status_code == 200
    assert len(list_resp.json()) >= 1
    
    # 5. Patch incident
    patch_resp = client.patch(f"/api/v1/incidents/{incident_id}", json={"status": "RESOLVED"}, headers=t_headers)
    assert patch_resp.status_code == 200
    assert patch_resp.json()["status"] == "RESOLVED"

def test_sos_cannot_spoof_another_tourist_id(auth_headers_tourist):
    """A tourist session must not be able to raise an SOS under someone else's tourist_id."""
    other_username = f"tourist_{uuid4().hex[:6]}"
    reg_resp = client.post("/api/v1/auth/register", json={
        "username": other_username,
        "password": "Password123!",
        "user_type": "tourist",
        "mfa_enabled": False,
    })
    assert reg_resp.status_code == 201
    other_tourist_id = reg_resp.json()["tourist_profile_id"]
    assert other_tourist_id != auth_headers_tourist["tourist_id"]

    headers = {"Authorization": auth_headers_tourist["Authorization"]}
    resp = client.post("/api/v1/sos", json={
        "tourist_id": other_tourist_id,
        "latitude": 32.2432,
        "longitude": 77.1892,
    }, headers=headers)

    assert resp.status_code == 201
    data = resp.json()
    assert data["tourist_id"] == auth_headers_tourist["tourist_id"]
    assert data["tourist_id"] != other_tourist_id


def test_incident_cannot_spoof_another_tourist_id(auth_headers_tourist):
    """A tourist session must not be able to file an incident as another tourist."""
    other_username = f"tourist_{uuid4().hex[:6]}"
    reg_resp = client.post("/api/v1/auth/register", json={
        "username": other_username,
        "password": "Password123!",
        "user_type": "tourist",
        "mfa_enabled": False,
    })
    assert reg_resp.status_code == 201
    other_tourist_id = reg_resp.json()["tourist_profile_id"]

    headers = {"Authorization": auth_headers_tourist["Authorization"]}
    resp = client.post("/api/v1/incidents", json={
        "tourist_id": other_tourist_id,
        "incident_type": "MANUAL",
        "priority": "HIGH",
        "status": "OPEN",
        "description": "Should be attributed to the authenticated tourist",
    }, headers=headers)

    assert resp.status_code == 201
    assert resp.json()["tourist_id"] == auth_headers_tourist["tourist_id"]
    assert resp.json()["tourist_id"] != other_tourist_id


def test_sos_alarm(auth_headers_tourist):
    headers = {"Authorization": auth_headers_tourist["Authorization"]}
    tourist_id = auth_headers_tourist["tourist_id"]
    
    sos_payload = {
        "tourist_id": tourist_id,
        "latitude": 40.7128,
        "longitude": -74.0060
    }
    
    resp = client.post("/api/v1/sos", json=sos_payload, headers=headers)
    assert resp.status_code == 201
    data = resp.json()
    assert data["sos_status"] == "PENDING"
    assert data["tourist_id"] == tourist_id
    assert data["incident_id"] is not None

def test_alerts(auth_headers_tourist):
    headers = {"Authorization": auth_headers_tourist["Authorization"]}
    tourist_id = auth_headers_tourist["tourist_id"]
    
    # Create incident first
    inc_payload = {
        "tourist_id": tourist_id,
        "incident_type": "MANUAL",
        "priority": "MEDIUM",
        "status": "OPEN",
        "description": "Heavy rainfall"
    }
    inc_resp = client.post("/api/v1/incidents", json=inc_payload, headers=headers)
    assert inc_resp.status_code == 201
    incident_id = inc_resp.json()["id"]
    
    # Create alert
    alert_payload = {
        "incident_id": incident_id,
        "channel": "SMS",
        "recipient": "+1987654321"
    }
    create_resp = client.post("/api/v1/alerts", json=alert_payload, headers=headers)
    assert create_resp.status_code == 201
    
    # List alerts
    list_resp = client.get(f"/api/v1/alerts?incident_id={incident_id}", headers=headers)
    assert list_resp.status_code == 200
    assert len(list_resp.json()) >= 1
    assert list_resp.json()[0]["incident_id"] == incident_id

def test_locations(auth_headers_tourist):
    headers = {"Authorization": auth_headers_tourist["Authorization"]}
    
    # Get locations
    resp = client.get("/api/v1/points-of-interest", headers=headers)
    assert resp.status_code == 200

def test_authority_endpoints(auth_headers_tourist, auth_headers_authority):
    a_headers = {"Authorization": auth_headers_authority["Authorization"]}
    t_headers = {"Authorization": auth_headers_tourist["Authorization"]}
    tourist_id = auth_headers_tourist["tourist_id"]
    
    # 1. Accessing authority details as tourist should fail (403)
    fail_resp = client.get("/api/v1/authority/incidents", headers=t_headers)
    assert fail_resp.status_code == 403
    
    # 2. Get authority incidents
    resp = client.get("/api/v1/authority/incidents", headers=a_headers)
    assert resp.status_code == 200
    
    # 3. Get tourist details
    tourist_resp = client.get(f"/api/v1/authority/tourists/{tourist_id}", headers=a_headers)
    assert tourist_resp.status_code == 200
    assert tourist_resp.json()["id"] == tourist_id


def test_itinerary_flows(auth_headers_tourist):
    headers = {"Authorization": auth_headers_tourist["Authorization"]}

    create_payload = {
        "title": "Manali Trip",
        "destinations": [
            {
                "name": "Rohtang Pass Viewpoint",
                "latitude": 32.3728,
                "longitude": 77.2491,
            }
        ]
    }
    create_resp = client.post("/api/v1/itinerary", json=create_payload, headers=headers)
    assert create_resp.status_code == 201
    itinerary_id = create_resp.json()["id"]
    assert create_resp.json()["tourist_id"] == auth_headers_tourist["tourist_id"]

    list_resp = client.get("/api/v1/itinerary", headers=headers)
    assert list_resp.status_code == 200
    assert any(e["id"] == itinerary_id for e in list_resp.json())

    delete_resp = client.delete(f"/api/v1/itinerary/{itinerary_id}", headers=headers)
    assert delete_resp.status_code == 204

    list_resp_after = client.get("/api/v1/itinerary", headers=headers)
    assert list_resp_after.status_code == 200
    assert not any(e["id"] == itinerary_id for e in list_resp_after.json())


def test_incident_response_logging(auth_headers_tourist, auth_headers_authority):
    t_headers = {"Authorization": auth_headers_tourist["Authorization"]}
    a_headers = {"Authorization": auth_headers_authority["Authorization"]}
    tourist_id = auth_headers_tourist["tourist_id"]

    inc_payload = {
        "tourist_id": tourist_id,
        "incident_type": "MANUAL",
        "priority": "HIGH",
        "status": "OPEN",
        "description": "Tourist requires medical assistance",
    }
    inc_resp = client.post("/api/v1/incidents", json=inc_payload, headers=t_headers)
    assert inc_resp.status_code == 201
    incident_id = inc_resp.json()["id"]

    # A tourist may not log a dispatch response (authority-only action).
    forbidden_resp = client.post(
        f"/api/v1/incidents/{incident_id}/responses",
        json={"responder_unit": "PCR-12", "action_taken": "Dispatched"},
        headers=t_headers,
    )
    assert forbidden_resp.status_code == 403

    response_resp = client.post(
        f"/api/v1/incidents/{incident_id}/responses",
        json={"responder_unit": "PCR-12", "action_taken": "Unit dispatched to scene"},
        headers=a_headers,
    )
    assert response_resp.status_code == 201
    assert response_resp.json()["incident_id"] == incident_id
    assert response_resp.json()["authority_id"] == auth_headers_authority["authority_id"]

    list_resp = client.get(f"/api/v1/incidents/{incident_id}/responses", headers=a_headers)
    assert list_resp.status_code == 200
    assert len(list_resp.json()) >= 1


def test_audit_logs(auth_headers_tourist, auth_headers_authority):
    a_headers = {"Authorization": auth_headers_authority["Authorization"]}
    t_headers = {"Authorization": auth_headers_tourist["Authorization"]}

    # Tourists may not write compliance audit logs.
    forbidden_resp = client.post(
        "/api/v1/audit-logs",
        json={"action_type": "TOURIST_LOOKUP", "target_id": "TR-1"},
        headers=t_headers,
    )
    assert forbidden_resp.status_code == 403

    create_resp = client.post(
        "/api/v1/audit-logs",
        json={
            "action_type": "TOURIST_LOOKUP",
            "target_id": "TR-1",
            "reason": "Routine check",
            "details": "Looked up tourist profile during patrol",
        },
        headers=a_headers,
    )
    assert create_resp.status_code == 201
    assert create_resp.json()["authority_id"] == auth_headers_authority["authority_id"]

    list_resp = client.get("/api/v1/audit-logs", headers=a_headers)
    assert list_resp.status_code == 200
    assert any(l["target_id"] == "TR-1" for l in list_resp.json())
