from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator, model_validator

_ZONE_TYPES = ("SAFE", "BUFFER", "RESTRICTED", "UNSAFE", "WARNING")
_GEOMETRY_TYPES = ("CIRCLE", "POLYGON")
_SEVERITIES = ("LOW", "MEDIUM", "HIGH", "CRITICAL")


class GeofenceCreate(BaseModel):
    name: str
    zone_type: str  # SAFE | BUFFER | RESTRICTED | UNSAFE | WARNING
    geometry_type: str = "POLYGON"  # CIRCLE | POLYGON

    # POLYGON zones (existing behavior, unchanged)
    coordinates: list[list[float]] | None = None  # [[lng, lat], ...] closed ring

    # CIRCLE zones (new — merged from Tanvi's module)
    center_lat: float | None = None
    center_lng: float | None = None
    radius_m: float | None = None

    severity: str = "MEDIUM"
    warning_message: str | None = None
    is_crowd_zone: bool = False
    is_active: bool = True

    @field_validator("zone_type")
    @classmethod
    def _validate_zone_type(cls, v: str) -> str:
        v = v.upper()
        if v not in _ZONE_TYPES:
            raise ValueError(f"zone_type must be one of {_ZONE_TYPES}")
        return v

    @field_validator("geometry_type")
    @classmethod
    def _validate_geometry_type(cls, v: str) -> str:
        v = v.upper()
        if v not in _GEOMETRY_TYPES:
            raise ValueError(f"geometry_type must be one of {_GEOMETRY_TYPES}")
        return v

    @field_validator("severity")
    @classmethod
    def _validate_severity(cls, v: str) -> str:
        v = v.upper()
        if v not in _SEVERITIES:
            raise ValueError(f"severity must be one of {_SEVERITIES}")
        return v

    @model_validator(mode="after")
    def _validate_geometry_payload(self) -> "GeofenceCreate":
        if self.geometry_type == "POLYGON":
            if not self.coordinates or len(self.coordinates) < 4:
                # keep the exact wording of the original validator so
                # existing frontend error handling doesn't need to change
                raise ValueError("coordinates must form a closed ring with at least 4 points (first == last)")
            if self.coordinates[0] != self.coordinates[-1]:
                self.coordinates = self.coordinates + [self.coordinates[0]]
        else:  # CIRCLE
            if self.center_lat is None or self.center_lng is None or self.radius_m is None:
                raise ValueError("CIRCLE geofences require center_lat, center_lng, and radius_m")
            if self.radius_m <= 0:
                raise ValueError("radius_m must be positive")
        return self


class GeofenceUpdate(BaseModel):
    name: str | None = None
    zone_type: str | None = None
    geometry_type: str | None = None
    coordinates: list[list[float]] | None = None
    center_lat: float | None = None
    center_lng: float | None = None
    radius_m: float | None = None
    severity: str | None = None
    warning_message: str | None = None
    is_crowd_zone: bool | None = None
    is_active: bool | None = None


class GeofenceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    zone_type: str
    geometry_type: str = "POLYGON"
    coordinates: list[list[float]] | None = None
    center_lat: float | None = None
    center_lng: float | None = None
    radius_m: float | None = None
    severity: str = "MEDIUM"
    warning_message: str | None = None
    is_crowd_zone: bool = False
    is_active: bool
    created_at: datetime


class GeofenceBreachResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tourist_id: UUID
    geofence_id: UUID
    latitude: float
    longitude: float
    breach_time: datetime
    sms_sent: bool
    event_type: str = "ENTERED"
    severity: str = "MEDIUM"
    message: str | None = None
