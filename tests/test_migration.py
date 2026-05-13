"""
Tests for data migration scripts.
"""

import pytest
import json
from datetime import date, datetime
from pathlib import Path
from migrations.v2_migration import (
    LegacyDataConverter,
    MigrationRunner,
    create_sample_legacy_data,
)
from src.models.skill_models import Skill, DailyLog, SkillLevel


class TestLegacyDataConverter:
    """Test cases for LegacyDataConverter."""

    def test_generate_id(self):
        """Test ID generation."""
        id1 = LegacyDataConverter.generate_id("skill")
        id2 = LegacyDataConverter.generate_id("skill")
        
        assert id1.startswith("skill_")
        assert id2.startswith("skill_")
        assert id1 != id2  # Should be unique

    def test_convert_skill_minimal(self):
        """Test converting minimal skill data."""
        legacy_data = {"name": "Python"}
        
        skill = LegacyDataConverter.convert_skill(legacy_data)
        
        assert skill.name == "Python"
        assert skill.level == SkillLevel.BEGINNER
        assert skill.id is not None

    def test_convert_skill_full(self):
        """Test converting complete skill data."""
        legacy_data = {
            "id": "custom_id",
            "name": "Advanced Python",
            "description": "Expert level Python programming",
            "level": "expert",
            "created_at": "2024-01-01T00:00:00",
        }
        
        skill = LegacyDataConverter.convert_skill(legacy_data)
        
        assert skill.id == "custom_id"
        assert skill.name == "Advanced Python"
        assert skill.description == "Expert level Python programming"
        assert skill.level == SkillLevel.EXPERT

    def test_convert_skill_numeric_level(self):
        """Test converting skill with numeric level."""
        legacy_data = {
            "name": "Data Analysis",
            "level": 1  # Should map to intermediate
        }
        
        skill = LegacyDataConverter.convert_skill(legacy_data)
        
        assert skill.level == SkillLevel.INTERMEDIATE

    def test_convert_skill_invalid_level(self):
        """Test converting skill with invalid level defaults to beginner."""
        legacy_data = {
            "name": "Unknown Level",
            "level": "invalid_value"
        }
        
        skill = LegacyDataConverter.convert_skill(legacy_data)
        
        assert skill.level == SkillLevel.BEGINNER

    def test_convert_skill_missing_name(self):
        """Test that missing name raises ValueError."""
        legacy_data = {"level": "beginner"}
        
        with pytest.raises(ValueError):
            LegacyDataConverter.convert_skill(legacy_data)

    def test_convert_skill_alternative_field_names(self):
        """Test converting skill with alternative field names."""
        legacy_data = {
            "skill_name": "Alternative Fields",
            "desc": "Uses different field names"
        }
        
        skill = LegacyDataConverter.convert_skill(legacy_data)
        
        assert skill.name == "Alternative Fields"
        assert skill.description == "Uses different field names"

    def test_convert_daily_log_minimal(self):
        """Test converting minimal log data."""
        legacy_data = {}
        
        log = LegacyDataConverter.convert_daily_log(legacy_data)
        
        assert log.date == date.today()
        assert log.duration_minutes == 0
        assert log.skill_id is not None

    def test_convert_daily_log_full(self):
        """Test converting complete log data."""
        legacy_data = {
            "id": "log_custom",
            "skill_id": "skill_123",
            "date": "2024-01-15",
            "duration_minutes": 90,
            "notes": "Great session",
            "rating": 5
        }
        
        log = LegacyDataConverter.convert_daily_log(legacy_data)
        
        assert log.id == "log_custom"
        assert log.skill_id == "skill_123"
        assert log.date == date(2024, 1, 15)
        assert log.duration_minutes == 90
        assert log.notes == "Great session"
        assert log.rating == 5

    def test_convert_daily_log_alternative_fields(self):
        """Test converting log with alternative field names."""
        legacy_data = {
            "log_date": "2024-01-16",
            "duration": 45,
            "note": "Short note"
        }
        
        log = LegacyDataConverter.convert_daily_log(legacy_data)
        
        assert log.date == date(2024, 1, 16)
        assert log.duration_minutes == 45
        assert log.notes == "Short note"

    def test_convert_daily_log_duration_clamping(self):
        """Test that duration is clamped to valid range."""
        # Negative duration
        log1 = LegacyDataConverter.convert_daily_log({"duration_minutes": -10})
        assert log1.duration_minutes == 0
        
        # Excessive duration
        log2 = LegacyDataConverter.convert_daily_log({"duration_minutes": 2000})
        assert log2.duration_minutes == 1440

    def test_convert_daily_log_rating_clamping(self):
        """Test that rating is clamped to 1-5 range."""
        log1 = LegacyDataConverter.convert_daily_log({"rating": 0})
        assert log1.rating == 1
        
        log2 = LegacyDataConverter.convert_daily_log({"rating": 10})
        assert log2.rating == 5

    def test_convert_batch(self):
        """Test batch conversion of skills."""
        legacy_skills = [
            {"name": "Skill 1"},
            {"name": "Skill 2", "level": "advanced"},
            {"invalid": "data"},  # This will fail
        ]
        
        skills = LegacyDataConverter.convert_batch(legacy_skills)
        
        assert len(skills) == 2
        assert skills[0].name == "Skill 1"
        assert skills[1].name == "Skill 2"


class TestMigrationRunner:
    """Test cases for MigrationRunner."""

    @pytest.fixture
    def temp_json_file(self, tmp_path):
        """Create a temporary JSON file with sample data."""
        data = create_sample_legacy_data()
        filepath = tmp_path / "legacy_data.json"
        with open(filepath, 'w') as f:
            json.dump(data, f)
        return str(filepath)

    def test_load_from_json_file(self, temp_json_file):
        """Test loading data from JSON file."""
        runner = MigrationRunner()
        
        data = runner.load_from_json_file(temp_json_file)
        
        assert 'skills' in data
        assert 'logs' in data
        assert len(data['skills']) == 3

    def test_load_nonexistent_file(self):
        """Test loading from nonexistent file raises error."""
        runner = MigrationRunner()
        
        with pytest.raises(FileNotFoundError):
            runner.load_from_json_file("/nonexistent/path.json")

    def test_migrate_skills_from_json_list(self, tmp_path):
        """Test migrating skills from JSON list format."""
        data = [{"name": "Test Skill 1"}, {"name": "Test Skill 2"}]
        filepath = tmp_path / "skills.json"
        with open(filepath, 'w') as f:
            json.dump(data, f)
        
        runner = MigrationRunner()
        skills = runner.migrate_skills_from_json(str(filepath))
        
        assert len(skills) == 2
        assert skills[0].name == "Test Skill 1"

    def test_migrate_skills_from_json_dict(self, tmp_path):
        """Test migrating skills from JSON dict format."""
        data = {"skills": [{"name": "Dict Skill"}]}
        filepath = tmp_path / "skills_dict.json"
        with open(filepath, 'w') as f:
            json.dump(data, f)
        
        runner = MigrationRunner()
        skills = runner.migrate_skills_from_json(str(filepath))
        
        assert len(skills) == 1
        assert skills[0].name == "Dict Skill"

    def test_export_to_json(self, tmp_path):
        """Test exporting migrated data to JSON."""
        runner = MigrationRunner()
        runner.migrated_skills = [Skill(id="s1", name="Exported Skill")]
        runner.migrated_logs = [
            DailyLog(id="l1", skill_id="s1", duration_minutes=30)
        ]
        
        output_path = tmp_path / "exported.json"
        runner.export_to_json(str(output_path))
        
        assert output_path.exists()
        
        with open(output_path, 'r') as f:
            exported = json.load(f)
        
        assert 'migration_timestamp' in exported
        assert len(exported['skills']) == 1
        assert len(exported['logs']) == 1
        assert exported['statistics']['total_skills'] == 1

    def test_get_statistics(self):
        """Test getting migration statistics."""
        runner = MigrationRunner()
        runner.migrated_skills = [
            Skill(id="s1", name="Beginner", level=SkillLevel.BEGINNER),
            Skill(id="s2", name="Expert", level=SkillLevel.EXPERT),
        ]
        runner.migrated_logs = [
            DailyLog(id="l1", skill_id="s1", duration_minutes=30),
            DailyLog(id="l2", skill_id="s1", duration_minutes=60),
        ]
        runner.errors = ["Sample error"]
        
        stats = runner.get_statistics()
        
        assert stats['skills_migrated'] == 2
        assert stats['logs_migrated'] == 2
        assert stats['errors'] == 1
        assert stats['skill_levels']['beginner'] == 1
        assert stats['skill_levels']['expert'] == 1


class TestSampleDataGeneration:
    """Test cases for sample data generation."""

    def test_create_sample_legacy_data(self):
        """Test sample data creation."""
        data = create_sample_legacy_data()
        
        assert isinstance(data, dict)
        assert 'skills' in data
        assert 'logs' in data
        assert len(data['skills']) == 3
        assert len(data['logs']) == 2
