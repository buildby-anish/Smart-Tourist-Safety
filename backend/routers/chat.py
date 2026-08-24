import logging
import requests
from fastapi import APIRouter, Depends, status
from pydantic import BaseModel
from typing import Optional

from config import Config
from db import is_db_active, get_authenticated_cursor
from routers.auth import get_current_user
from schemas.auth import SessionResponse

logger = logging.getLogger("chat")
router = APIRouter(prefix="/chat", tags=["chat"])

class ChatRequest(BaseModel):
    message: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    language: Optional[str] = "en"

class ChatResponse(BaseModel):
    response: str
    fallback: bool = False

@router.post("", response_model=ChatResponse)
def chat_with_assistant(
    payload: ChatRequest,
    current_user: SessionResponse = Depends(get_current_user)
) -> ChatResponse:
    # 1. Check if GROQ_API_KEY is configured. If not, signal fallback.
    if not Config.GROQ_API_KEY:
        logger.warning("GROQ_API_KEY is not set. Falling back to local rule-based response.")
        return ChatResponse(response="", fallback=True)

    # 2. Gather context
    geofences_context = []
    pois_context = []

    # Get geofences from DB
    if is_db_active():
        try:
            with get_authenticated_cursor(current_user.auth_user_id) as cur:
                # Get active geofences
                cur.execute("SELECT name, zone_type, coordinates FROM public.geofences WHERE is_active = TRUE;")
                for row in cur.fetchall():
                    geofences_context.append({
                        "name": row[0],
                        "zone_type": row[1],
                        "coordinates": row[2]
                    })
                
                # Get POIs
                cur.execute("SELECT name, latitude, longitude, risk_level FROM public.points_of_interest LIMIT 50;")
                for row in cur.fetchall():
                    pois_context.append({
                        "name": row[0],
                        "latitude": float(row[1]) if row[1] is not None else None,
                        "longitude": float(row[2]) if row[2] is not None else None,
                        "risk_level": row[3]
                    })
        except Exception as e:
            logger.error(f"Error querying database for chat context: {e}")
            # Do not fail; continue with empty context and let Groq respond with what it knows
            pass

    # If DB is not active or we have no POIs, use a default list for basic context
    if not pois_context:
        static_pois = [
            {"name": "Gateway of India", "latitude": 18.9220, "longitude": 72.8347, "type": "attraction"},
            {"name": "Taj Mahal Palace", "latitude": 18.9256, "longitude": 72.8242, "type": "hotel"},
            {"name": "Café Mondegar", "latitude": 18.9280, "longitude": 72.8300, "type": "restaurant"},
            {"name": "Colaba Causeway", "latitude": 18.9150, "longitude": 72.8280, "type": "attraction"},
            {"name": "St. George Hospital", "latitude": 18.9300, "longitude": 72.8350, "type": "hospital"},
            {"name": "Colaba Police Stn", "latitude": 18.9190, "longitude": 72.8270, "type": "police"},
            {"name": "Trident Nariman", "latitude": 18.9340, "longitude": 72.8260, "type": "hotel"},
            {"name": "Leopold Café", "latitude": 18.9240, "longitude": 72.8400, "type": "restaurant"}
        ]
        pois_context = static_pois

    # 3. Build system instructions
    system_prompt = (
        "You are the Suraksha AI Safety Assistant, a premium real-time tourist safety assistant.\n"
        "Your goal is to provide safety recommendations, emergency numbers, and help points to tourists.\n"
        "You have access to live location context and safety zones/POIs from the app. Use them to provide precise answers.\n"
    )

    if payload.latitude is not None and payload.longitude is not None:
        system_prompt += f"The tourist's current location is Latitude: {payload.latitude}, Longitude: {payload.longitude}.\n"

    # Add geofences to context
    if geofences_context:
        system_prompt += "Active Geofenced Safety Zones in the area:\n"
        for gf in geofences_context:
            system_prompt += f"- Name: '{gf['name']}', Type: {gf['zone_type']} (SAFE/BUFFER/RESTRICTED)\n"
    else:
        system_prompt += "No custom geofenced safety zones are currently configured near this location.\n"

    # Add POIs to context
    system_prompt += "Known Places and Help Points nearby:\n"
    for poi in pois_context:
        poi_type = poi.get("type", poi.get("risk_level", "Location"))
        system_prompt += f"- {poi['name']} ({poi_type}) at Lat: {poi.get('latitude')}, Lng: {poi.get('longitude')}\n"

    system_prompt += (
        "\nGuidelines:\n"
        "1. Be polite, concise, and helpful.\n"
        "2. If asked about safety, check if their location is near restricted/buffer geofences or high-risk POIs.\n"
        "3. If they need medical or police help, guide them to the nearest hospital or police station using the coordinates/places listed.\n"
        "4. If it's a critical emergency, tell them to use the app's SOS button or dial 112 (India's emergency number).\n"
        "5. Respond in the language requested: English if language is 'en', Hindi if language is 'hi'. If they ask a question in Hindi, respond in Hindi.\n"
    )

    # 4. Make request to Groq API
    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {Config.GROQ_API_KEY}",
        "Content-Type": "application/json"
    }
    
    body = {
        "model": "llama-3.3-70b-versatile",
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": payload.message}
        ],
        "temperature": 0.5,
        "max_tokens": 512
    }

    try:
        response = requests.post(url, headers=headers, json=body, timeout=10)
        if response.status_code == 200:
            res_data = response.json()
            ai_reply = res_data["choices"][0]["message"]["content"]
            return ChatResponse(response=ai_reply, fallback=False)
        else:
            logger.error(f"Groq API returned error status {response.status_code}: {response.text}")
            # Try fallback model if first fails
            if response.status_code == 404 or response.status_code == 400:
                logger.info("Attempting backup model llama-3.1-8b-instant...")
                body["model"] = "llama-3.1-8b-instant"
                response = requests.post(url, headers=headers, json=body, timeout=10)
                if response.status_code == 200:
                    res_data = response.json()
                    ai_reply = res_data["choices"][0]["message"]["content"]
                    return ChatResponse(response=ai_reply, fallback=False)
            
            # If all fails, fall back to rule-based
            return ChatResponse(response="", fallback=True)
    except Exception as e:
        logger.error(f"Exception during Groq API call: {e}")
        return ChatResponse(response="", fallback=True)
