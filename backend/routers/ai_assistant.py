import logging

import requests
from fastapi import APIRouter, HTTPException, status

from config import Config
from schemas.ai_assistant import TravelChatRequest, TravelChatResponse

logger = logging.getLogger("ai_assistant")
router = APIRouter(prefix="/ai", tags=["ai"])

# Groq's API is OpenAI-compatible, so this is a plain chat/completions
# call — no special SDK needed. Model name is env-configurable since Groq
# periodically retires/renames free-tier models; this is the current
# (Aug 2026) generally-available default.
GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "llama-3.3-70b-versatile"

# Keeps the assistant on-topic and bounds cost/abuse. This is a system
# prompt, not a hard filter — a sufficiently adversarial user could try to
# jailbreak it, so anything safety-critical (emergency numbers, nearest
# hospital/police) should keep using the deterministic rule-based path in
# the frontend rather than depend on this holding 100% of the time.
SYSTEM_PROMPT = (
    "You are the travel and safety assistant inside Suraksha Setu, a tourist "
    "safety app for travelers in India. You ONLY answer questions about: "
    "travel planning and itineraries, local attractions and culture in India, "
    "transport and directions, local safety and precautions, weather-appropriate "
    "packing, food/etiquette guidance, and emergency/help information for "
    "tourists in India. "
    "If the user asks about anything unrelated to travel or safety (coding, "
    "general trivia, personal advice, other countries unrelated to their trip, "
    "or anything else outside this scope), politely decline in one sentence and "
    "redirect them to ask a travel or safety question instead — do not answer "
    "the off-topic question even partially. "
    "Keep answers concise (2-4 sentences unless the user asks for a list/itinerary). "
    "If someone describes an active emergency, tell them to use the SOS button "
    "in the app and call 112 (India's emergency number) immediately."
)

_MAX_MESSAGE_CHARS = 800
_MAX_HISTORY_TURNS = 6  # most recent N turns only, to bound tokens per request


@router.post("/chat", response_model=TravelChatResponse)
def travel_chat(payload: TravelChatRequest) -> TravelChatResponse:
    if not Config.is_groq_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI assistant is not configured on the server yet.",
        )

    message = payload.message.strip()
    if not message:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Message cannot be empty.")
    if len(message) > _MAX_MESSAGE_CHARS:
        message = message[:_MAX_MESSAGE_CHARS]

    trimmed_history = payload.history[-_MAX_HISTORY_TURNS:]
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for turn in trimmed_history:
        if turn.role in ("user", "assistant") and turn.content.strip():
            messages.append({"role": turn.role, "content": turn.content.strip()[:_MAX_MESSAGE_CHARS]})
    messages.append({"role": "user", "content": message})

    try:
        resp = requests.post(
            GROQ_CHAT_URL,
            headers={
                "Authorization": f"Bearer {Config.GROQ_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "model": GROQ_MODEL,
                "messages": messages,
                "temperature": 0.4,
                "max_tokens": 400,
            },
            timeout=20,
        )
    except requests.RequestException as e:
        logger.error(f"Groq request failed: {e}")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Couldn't reach the AI assistant. Please try again.")

    if resp.status_code != 200:
        logger.error(f"Groq returned {resp.status_code}: {resp.text[:500]}")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="AI assistant is temporarily unavailable.")

    try:
        data = resp.json()
        reply = data["choices"][0]["message"]["content"].strip()
    except (KeyError, IndexError, ValueError) as e:
        logger.error(f"Unexpected Groq response shape: {e} | body={resp.text[:500]}")
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="AI assistant returned an unexpected response.")

    if not reply:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="AI assistant returned an empty response.")

    return TravelChatResponse(reply=reply)
