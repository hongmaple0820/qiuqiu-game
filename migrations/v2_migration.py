"""
Data migration scripts for V2 architecture.

This module provides utilities to migrate legacy data formats
to the new Pydantic-based models.
"""

import json
import uuid
from datetime import datetime, date
from typing import List, Dict, Any, Optional
from pathlib import Path

from src.models.skill_models import Skill, DailyLog, SkillLevel


class LegacyDataConverter:
    """
    Converts legacy data formats to V2 Pydantic models.
    
    Supports multiple legacy formats including:
    - Dictionary-based skill records
    - JSON exports from previous versions
    - CSV-like structures
    """

    @staticmethod
    def generate_id(prefix: str = "") -> str:
        """Generate a unique ID with optional prefix."""
        unique_id = str(uuid.uuid4())[:8]
        return f"{prefix}_{unique_id}" if prefix else unique_id

    @classmethod
    def convert_skill(cls, legacy_data: Dict[str, Any]) -> Skill:
        """
        Convert a legacy skill dictionary to a Pydantic Skill model.
        
        Args:
            legacy_data: Dictionary containing legacy skill data
            
        Returns:
            Skill: New Pydantic Skill instance
            
        Raises:
            ValueError: If required fields are missing
        """
        # Extract and validate required fields
        name = legacy_data.get('name') or legacy_data.get('skill_name')
        if not name:
            raise ValueError("Skill name is required")

        # Map legacy level values to SkillLevel enum
        level_value = legacy_data.get('level', 'beginner')
        if isinstance(level_value, int):
            level_map = {0: 'beginner', 1: 'intermediate', 2: 'advanced', 3: 'expert'}
            level_value = level_map.get(level_value, 'beginner')
        
        try:
            level = SkillLevel(level_value.lower() if isinstance(level_value, str) else 'beginner')
        except ValueError:
            level = SkillLevel.BEGINNER

        # Handle timestamps
        created_at = legacy_data.get('created_at')
        if created_at:
            if isinstance(created_at, str):
                created_at = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
        else:
            created_at = datetime.utcnow()

        updated_at = legacy_data.get('updated_at')
        if updated_at:
            if isinstance(updated_at, str):
                updated_at = datetime.fromisoformat(updated_at.replace('Z', '+00:00'))
        else:
            updated_at = created_at

        return Skill(
            id=legacy_data.get('id') or cls.generate_id('skill'),
            name=str(name).strip(),
            description=legacy_data.get('description') or legacy_data.get('desc'),
            level=level,
            created_at=created_at,
            updated_at=updated_at,
        )

    @classmethod
    def convert_daily_log(cls, legacy_data: Dict[str, Any], skill_id: Optional[str] = None) -> DailyLog:
        """
        Convert a legacy daily log dictionary to a Pydantic DailyLog model.
        
        Args:
            legacy_data: Dictionary containing legacy log data
            skill_id: Optional skill ID override
            
        Returns:
            DailyLog: New Pydantic DailyLog instance
        """
        # Extract date
        log_date = legacy_data.get('date') or legacy_data.get('log_date')
        if log_date:
            if isinstance(log_date, str):
                log_date = date.fromisoformat(log_date)
        else:
            log_date = date.today()

        # Extract duration
        duration = legacy_data.get('duration_minutes') or legacy_data.get('duration') or 0
        duration = int(duration)

        # Validate duration range
        if duration < 0:
            duration = 0
        elif duration > 1440:
            duration = 1440

        # Extract rating
        rating = legacy_data.get('rating')
        if rating is not None:
            rating = int(rating)
            if rating < 1:
                rating = 1
            elif rating > 5:
                rating = 5

        return DailyLog(
            id=legacy_data.get('id') or cls.generate_id('log'),
            skill_id=skill_id or legacy_data.get('skill_id') or cls.generate_id('skill'),
            date=log_date,
            duration_minutes=duration,
            notes=legacy_data.get('notes') or legacy_data.get('note'),
            rating=rating,
        )

    @classmethod
    def convert_batch(cls, legacy_skills: List[Dict[str, Any]]) -> List[Skill]:
        """Convert a batch of legacy skill records."""
        skills = []
        errors = []
        
        for i, data in enumerate(legacy_skills):
            try:
                skill = cls.convert_skill(data)
                skills.append(skill)
            except Exception as e:
                errors.append(f"Error converting skill {i}: {str(e)}")
        
        if errors:
            print(f"Warning: {len(errors)} conversion errors occurred:")
            for error in errors[:5]:  # Show first 5 errors
                print(f"  - {error}")
            if len(errors) > 5:
                print(f"  ... and {len(errors) - 5} more")
        
        return skills


class MigrationRunner:
    """
    Orchestrates the data migration process.
    
    Provides methods to:
    - Load legacy data from various sources
    - Convert to new format
    - Validate migrated data
    - Export results
    """

    def __init__(self, converter: Optional[LegacyDataConverter] = None):
        self.converter = converter or LegacyDataConverter()
        self.migrated_skills: List[Skill] = []
        self.migrated_logs: List[DailyLog] = []
        self.errors: List[str] = []

    def load_from_json_file(self, filepath: str) -> Dict[str, Any]:
        """Load legacy data from a JSON file."""
        path = Path(filepath)
        if not path.exists():
            raise FileNotFoundError(f"Migration file not found: {filepath}")
        
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)

    def migrate_skills_from_json(self, filepath: str) -> List[Skill]:
        """Migrate skills from a JSON file."""
        data = self.load_from_json_file(filepath)
        
        # Handle different JSON structures
        if isinstance(data, list):
            skills_data = data
        elif isinstance(data, dict):
            skills_data = data.get('skills', data.get('data', []))
        else:
            raise ValueError("Unexpected JSON structure")
        
        self.migrated_skills = self.converter.convert_batch(skills_data)
        return self.migrated_skills

    def migrate_logs_from_json(self, filepath: str, skill_id_map: Optional[Dict[str, str]] = None) -> List[DailyLog]:
        """Migrate daily logs from a JSON file."""
        data = self.load_from_json_file(filepath)
        
        if isinstance(data, list):
            logs_data = data
        elif isinstance(data, dict):
            logs_data = data.get('logs', data.get('daily_logs', []))
        else:
            raise ValueError("Unexpected JSON structure")
        
        self.migrated_logs = []
        for log_data in logs_data:
            try:
                # Map old skill IDs to new ones if provided
                old_skill_id = log_data.get('skill_id')
                new_skill_id = skill_id_map.get(old_skill_id) if skill_id_map else None
                
                log = self.converter.convert_daily_log(log_data, new_skill_id)
                self.migrated_logs.append(log)
            except Exception as e:
                self.errors.append(f"Error migrating log: {str(e)}")
        
        return self.migrated_logs

    def export_to_json(self, output_path: str, indent: int = 2) -> None:
        """Export migrated data to JSON file."""
        output = {
            'migration_timestamp': datetime.utcnow().isoformat(),
            'skills': [skill.model_dump(mode='json') for skill in self.migrated_skills],
            'logs': [log.model_dump(mode='json') for log in self.migrated_logs],
            'statistics': {
                'total_skills': len(self.migrated_skills),
                'total_logs': len(self.migrated_logs),
                'errors_count': len(self.errors),
            }
        }
        
        path = Path(output_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(output, f, indent=indent, default=str)
        
        print(f"Migration exported to: {output_path}")

    def get_statistics(self) -> Dict[str, Any]:
        """Get migration statistics."""
        return {
            'skills_migrated': len(self.migrated_skills),
            'logs_migrated': len(self.migrated_logs),
            'errors': len(self.errors),
            'skill_levels': {
                level.value: sum(1 for s in self.migrated_skills if s.level == level)
                for level in SkillLevel
            }
        }


def create_sample_legacy_data() -> Dict[str, Any]:
    """Create sample legacy data for testing migrations."""
    return {
        'skills': [
            {
                'name': 'Python Programming',
                'level': 'intermediate',
                'description': 'Core Python development skills',
            },
            {
                'name': 'Data Analysis',
                'level': 1,  # Numeric level format
                'desc': 'Statistical analysis and visualization',
            },
            {
                'name': 'Machine Learning',
                'level': 'beginner',
            }
        ],
        'logs': [
            {
                'date': '2024-01-15',
                'duration_minutes': 90,
                'notes': 'Completed pandas tutorial',
                'rating': 4,
            },
            {
                'date': '2024-01-16',
                'duration': 60,
                'note': 'Practice exercises',
                'rating': 3,
            }
        ]
    }


if __name__ == '__main__':
    # Demo migration with sample data
    print("=== V2 Architecture Migration Demo ===\n")
    
    # Create sample legacy data
    sample_data = create_sample_legacy_data()
    
    # Save to temporary file
    temp_file = '/tmp/legacy_data.json'
    with open(temp_file, 'w') as f:
        json.dump(sample_data, f, indent=2)
    
    print(f"Created sample legacy data at: {temp_file}\n")
    
    # Run migration
    runner = MigrationRunner()
    
    print("Migrating skills...")
    skills = runner.migrate_skills_from_json(temp_file)
    for skill in skills:
        print(f"  ✓ {skill.name} ({skill.level.value})")
    
    print("\nMigrating logs...")
    # Create skill ID map for logs
    skill_id_map = {}
    for i, skill in enumerate(skills):
        skill_id_map[f'skill_{i}'] = skill.id
    
    logs = runner.migrate_logs_from_json(temp_file)
    for log in logs:
        print(f"  ✓ {log.date}: {log.duration_minutes} mins (rating: {log.rating})")
    
    # Export results
    output_file = '/tmp/migrated_data.json'
    runner.export_to_json(output_file)
    
    # Print statistics
    stats = runner.get_statistics()
    print(f"\n=== Migration Statistics ===")
    print(f"Skills migrated: {stats['skills_migrated']}")
    print(f"Logs migrated: {stats['logs_migrated']}")
    print(f"Errors: {stats['errors']}")
    print(f"Skill levels distribution: {stats['skill_levels']}")
