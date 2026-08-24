from pydantic import BaseModel


class ChatTurn(BaseModel):
    role: str  # "user" or "assistant" — mirrors Groq/OpenAI's chat message roles
    content: str


class TravelChatRequest(BaseModel):
    message: str
    # Prior turns for conversational context, oldest first. Capped
    # server-side (see routers/ai_assistant.py) regardless of what's sent,
    # to bound token usage per request.
    history: list[ChatTurn] = []


class TravelChatResponse(BaseModel):
    reply: str
