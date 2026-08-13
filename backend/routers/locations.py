from uuid import UUID

from schemas.location import LocationResponse

# Temporary in-memory location storage for local API development only.
# Replace with PostgreSQL queries when database connection details are provided.
_in_memory_location_store: dict[UUID, LocationResponse] = {}
