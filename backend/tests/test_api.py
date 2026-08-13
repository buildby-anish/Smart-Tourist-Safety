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
    tourist_id = login_resp.json()["tourist_id"]
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
    assert "digital_id" in did_resp.json()
    
    # Update profile
    patch_resp = client.patch(f"/api/v1/tourists/{tourist_id}", headers=headers, json={
        "full_name": "Updated Full Name",
        "phone": "+1234567890",
        "emergency_contact": "Emergency Contact Info"
    })
    assert patch_resp.status_code == 200
    assert patch_resp.json()["full_name"] == "Updated Full Name"
    assert patch_resp.json()["phone"] == "+1234567890"

def test_incident_flows(auth_headers_tourist, auth_headers_authority):
    t_headers = {"Authorization": auth_headers_tourist["Authorization"]}
    a_headers = {"Authorization": auth_headers_authority["Authorization"]}
    tourist_id = auth_headers_tourist["tourist_id"]
    
    # 1. Create location first
    location_id = str(uuid4())
    
    # 2. Create incident
    inc_payload = {
        "tourist_id": tourist_id,
        "location_id": location_id,
        "incident_type": "THEFT",
        "severity": "HIGH",
        "status": "OPEN",
        "description": "Stolen backpack at monument"
    }
    
    create_resp = client.post("/api/v1/incidents", json=inc_payload, headers=t_headers)
    assert create_resp.status_code == 201
    incident_id = create_resp.json()["incident_id"]
    
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
    assert data["sos_status"] == "ACTIVE"
    assert data["status"] == "OPEN"
    assert data["tourist_id"] == tourist_id
    assert data["location_id"] is not None
    assert data["incident_id"] is not None

def test_alerts(auth_headers_tourist):
    headers = {"Authorization": auth_headers_tourist["Authorization"]}
    tourist_id = auth_headers_tourist["tourist_id"]
    
    # Create incident first
    inc_payload = {
        "tourist_id": tourist_id,
        "incident_type": "WEATHER",
        "severity": "MEDIUM",
        "status": "OPEN",
        "description": "Heavy rainfall"
    }
    inc_resp = client.post("/api/v1/incidents", json=inc_payload, headers=headers)
    assert inc_resp.status_code == 201
    incident_id = inc_resp.json()["incident_id"]
    
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
    resp = client.get("/api/v1/locations", headers=headers)
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
    assert tourist_resp.json()["tourist_id"] == tourist_id
