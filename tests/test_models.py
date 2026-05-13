"""
Tests for Pydantic models: Skill, DailyLog, and related classes.
"""

import pytest
from datetime import date, datetime
from src.models.skill_models import Skill, DailyLog, SkillLevel, SkillWithLogs


class TestSkillModel:
    """Test cases for the Skill Pydantic model."""

    def test_create_valid_skill(self):
        """Test creating a skill with valid data."""
        skill = Skill(
            id="skill_001",
            name="Python Programming",
            description="Core Python development",
            level=SkillLevel.INTERMEDIATE
        )
        
        assert skill.id == "skill_001"
        assert skill.name == "Python Programming"
        assert skill.description == "Core Python development"
        assert skill.level == SkillLevel.INTERMEDIATE
        assert isinstance(skill.created_at, datetime)
        assert isinstance(skill.updated_at, datetime)

    def test_skill_default_values(self):
        """Test that default values are applied correctly."""
        skill = Skill(id="skill_002", name="Testing")
        
        assert skill.level == SkillLevel.BEGINNER
        assert skill.description is None
        assert skill.created_at is not None

    def test_skill_name_validation_empty(self):
        """Test that empty skill names are rejected."""
        with pytest.raises(ValueError) as exc_info:
            Skill(id="skill_003", name="")
        
        # Pydantic raises ValidationError with string_too_short message
        assert "too_short" in str(exc_info.value).lower() or "at least 1 character" in str(exc_info.value).lower()

    def test_skill_name_validation_whitespace(self):
        """Test that whitespace-only names are rejected."""
        with pytest.raises(ValueError):
            Skill(id="skill_004", name="   ")

    def test_skill_name_max_length(self):
        """Test skill name max length validation."""
        long_name = "A" * 101
        with pytest.raises(ValueError):
            Skill(id="skill_005", name=long_name)

    def test_skill_update_level(self):
        """Test updating skill level."""
        skill = Skill(id="skill_006", name="Testing", level=SkillLevel.BEGINNER)
        
        old_updated_at = skill.updated_at
        skill.update_level(SkillLevel.ADVANCED)
        
        assert skill.level == SkillLevel.ADVANCED
        assert skill.updated_at >= old_updated_at

    def test_skill_serialization(self):
        """Test skill model serialization to dict."""
        skill = Skill(id="skill_007", name="Serialization Test")
        
        data = skill.model_dump()
        
        assert data['id'] == "skill_007"
        assert data['name'] == "Serialization Test"
        assert data['level'] == "beginner"

    def test_skill_from_dict(self):
        """Test creating skill from dictionary."""
        data = {
            'id': 'skill_008',
            'name': 'Dict Creation',
            'level': 'expert'
        }
        
        skill = Skill(**data)
        
        assert skill.id == 'skill_008'
        assert skill.name == 'Dict Creation'
        assert skill.level == SkillLevel.EXPERT


class TestDailyLogModel:
    """Test cases for the DailyLog Pydantic model."""

    def test_create_valid_log(self):
        """Test creating a daily log with valid data."""
        log = DailyLog(
            id="log_001",
            skill_id="skill_001",
            date=date(2024, 1, 15),
            duration_minutes=60,
            notes="Completed tutorial",
            rating=4
        )
        
        assert log.id == "log_001"
        assert log.skill_id == "skill_001"
        assert log.date == date(2024, 1, 15)
        assert log.duration_minutes == 60
        assert log.notes == "Completed tutorial"
        assert log.rating == 4

    def test_log_default_date(self):
        """Test that default date is today."""
        log = DailyLog(id="log_002", skill_id="skill_001", duration_minutes=30)
        
        assert log.date == date.today()

    def test_log_duration_validation_negative(self):
        """Test that negative duration is rejected."""
        with pytest.raises(ValueError):
            DailyLog(id="log_003", skill_id="skill_001", duration_minutes=-10)

    def test_log_duration_validation_excessive(self):
        """Test that excessive duration (>1440 mins) is rejected."""
        with pytest.raises(ValueError):
            DailyLog(id="log_004", skill_id="skill_001", duration_minutes=1500)

    def test_log_rating_validation_low(self):
        """Test that rating below 1 is rejected."""
        with pytest.raises(ValueError):
            DailyLog(id="log_005", skill_id="skill_001", duration_minutes=30, rating=0)

    def test_log_rating_validation_high(self):
        """Test that rating above 5 is rejected."""
        with pytest.raises(ValueError):
            DailyLog(id="log_006", skill_id="skill_001", duration_minutes=30, rating=6)

    def test_log_optional_notes(self):
        """Test that notes are optional."""
        log = DailyLog(id="log_007", skill_id="skill_001", duration_minutes=45)
        
        assert log.notes is None

    def test_log_optional_rating(self):
        """Test that rating is optional."""
        log = DailyLog(id="log_008", skill_id="skill_001", duration_minutes=45)
        
        assert log.rating is None

    def test_log_notes_stripping(self):
        """Test that notes are stripped of whitespace."""
        log = DailyLog(
            id="log_009",
            skill_id="skill_001",
            duration_minutes=30,
            notes="  Trimmed notes  "
        )
        
        assert log.notes == "Trimmed notes"

    def test_log_serialization(self):
        """Test log model serialization."""
        log = DailyLog(
            id="log_010",
            skill_id="skill_001",
            duration_minutes=90,
            rating=5
        )
        
        data = log.model_dump(mode='json')
        
        assert data['id'] == "log_010"
        assert data['duration_minutes'] == 90
        assert data['date'] == str(date.today())


class TestSkillWithLogsModel:
    """Test cases for the aggregated SkillWithLogs model."""

    def test_create_aggregated_model(self):
        """Test creating SkillWithLogs from skill and logs."""
        skill = Skill(id="skill_001", name="Python")
        logs = [
            DailyLog(id="log_001", skill_id="skill_001", duration_minutes=60, rating=4),
            DailyLog(id="log_002", skill_id="skill_001", duration_minutes=30, rating=5),
        ]
        
        aggregated = SkillWithLogs.from_skill_and_logs(skill, logs)
        
        assert aggregated.skill.id == "skill_001"
        assert len(aggregated.logs) == 2
        assert aggregated.total_practice_minutes == 90
        assert aggregated.average_rating == 4.5

    def test_aggregated_model_empty_logs(self):
        """Test SkillWithLogs with no logs."""
        skill = Skill(id="skill_002", name="Empty Skill")
        
        aggregated = SkillWithLogs.from_skill_and_logs(skill, [])
        
        assert aggregated.total_practice_minutes == 0
        assert aggregated.average_rating is None

    def test_aggregated_model_no_ratings(self):
        """Test SkillWithLogs when logs have no ratings."""
        skill = Skill(id="skill_003", name="No Ratings")
        logs = [
            DailyLog(id="log_003", skill_id="skill_003", duration_minutes=45, rating=None),
        ]
        
        aggregated = SkillWithLogs.from_skill_and_logs(skill, logs)
        
        assert aggregated.total_practice_minutes == 45
        assert aggregated.average_rating is None


class TestSkillLevelEnum:
    """Test cases for the SkillLevel enumeration."""

    def test_skill_level_values(self):
        """Test skill level enum values."""
        assert SkillLevel.BEGINNER.value == "beginner"
        assert SkillLevel.INTERMEDIATE.value == "intermediate"
        assert SkillLevel.ADVANCED.value == "advanced"
        assert SkillLevel.EXPERT.value == "expert"

    def test_skill_level_from_string(self):
        """Test creating SkillLevel from string."""
        level = SkillLevel("intermediate")
        assert level == SkillLevel.INTERMEDIATE

    def test_skill_level_invalid_value(self):
        """Test that invalid level values raise ValueError."""
        with pytest.raises(ValueError):
            SkillLevel("invalid_level")
