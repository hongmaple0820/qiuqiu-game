"""
Pydantic models for Skill and DailyLog entities.

This module defines the core data models using Pydantic v2,
providing type safety, validation, and serialization capabilities.
"""

from datetime import date as date_type, datetime
from typing import Optional, List
from pydantic import BaseModel, Field, field_validator
from enum import Enum


class SkillLevel(str, Enum):
    """Enumeration of skill proficiency levels."""
    BEGINNER = "beginner"
    INTERMEDIATE = "intermediate"
    ADVANCED = "advanced"
    EXPERT = "expert"


class Skill(BaseModel):
    """
    Model representing a skill that can be tracked and improved.
    
    Attributes:
        id: Unique identifier for the skill
        name: Name of the skill
        description: Optional detailed description
        level: Current proficiency level
        created_at: Timestamp when the skill was added
        updated_at: Timestamp of last modification
    """
    id: str = Field(..., description="Unique identifier for the skill")
    name: str = Field(..., min_length=1, max_length=100, description="Name of the skill")
    description: Optional[str] = Field(None, max_length=500, description="Detailed description")
    level: SkillLevel = Field(default=SkillLevel.BEGINNER, description="Current proficiency level")
    created_at: datetime = Field(default_factory=datetime.utcnow, description="Creation timestamp")
    updated_at: datetime = Field(default_factory=datetime.utcnow, description="Last update timestamp")

    @field_validator('name')
    @classmethod
    def name_must_not_be_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError('Skill name cannot be empty or whitespace only')
        return v.strip()

    def update_level(self, new_level: SkillLevel) -> 'Skill':
        """Update the skill level and refresh the updated_at timestamp."""
        self.level = new_level
        self.updated_at = datetime.utcnow()
        return self


class DailyLog(BaseModel):
    """
    Model representing a daily log entry for skill tracking.
    
    Attributes:
        id: Unique identifier for the log entry
        skill_id: Reference to the associated skill
        date: Date of the log entry
        duration_minutes: Time spent practicing (in minutes)
        notes: Optional notes about the practice session
        rating: Self-assessment rating (1-5)
        created_at: Timestamp when the log was created
    """
    id: str = Field(..., description="Unique identifier for the log entry")
    skill_id: str = Field(..., description="Reference to the associated skill")
    date: date_type = Field(default_factory=date_type.today, description="Date of the log entry")
    duration_minutes: int = Field(..., ge=0, le=1440, description="Practice duration in minutes")
    notes: Optional[str] = Field(None, max_length=1000, description="Practice session notes")
    rating: Optional[int] = Field(None, ge=1, le=5, description="Self-assessment rating")
    created_at: datetime = Field(default_factory=datetime.utcnow, description="Creation timestamp")

    @field_validator('notes')
    @classmethod
    def strip_notes(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            return v.strip() if v.strip() else None
        return v

    class Config:
        json_schema_extra = {
            "example": {
                "id": "log_001",
                "skill_id": "skill_python",
                "date": "2024-01-15",
                "duration_minutes": 60,
                "notes": "Completed advanced decorators tutorial",
                "rating": 4
            }
        }


class SkillWithLogs(BaseModel):
    """
    Aggregated model showing a skill with its associated logs.
    Useful for reporting and dashboard views.
    """
    skill: Skill
    logs: List[DailyLog] = Field(default_factory=list)
    total_practice_minutes: int = Field(default=0, description="Total practice time across all logs")
    average_rating: Optional[float] = Field(None, description="Average rating across all logs")

    @classmethod
    def from_skill_and_logs(cls, skill: Skill, logs: List[DailyLog]) -> 'SkillWithLogs':
        """Create an aggregated view from skill and its logs."""
        total_minutes = sum(log.duration_minutes for log in logs)
        ratings = [log.rating for log in logs if log.rating is not None]
        avg_rating = sum(ratings) / len(ratings) if ratings else None
        
        return cls(
            skill=skill,
            logs=logs,
            total_practice_minutes=total_minutes,
            average_rating=avg_rating
        )
