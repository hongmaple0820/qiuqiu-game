"""
Tests for storage layer abstraction and in-memory implementation.
"""

import pytest
from datetime import date, datetime
from src.models.skill_models import Skill, DailyLog, SkillLevel
from src.storage.in_memory import (
    InMemorySkillStorage,
    InMemoryDailyLogStorage,
    InMemoryUnitOfWork,
    InMemoryStorageProvider,
)
from src.storage.abstract import NotFoundError, DuplicateError


@pytest.fixture
def sample_skill():
    """Create a sample skill for testing."""
    return Skill(
        id="skill_test_001",
        name="Test Skill",
        description="A skill for testing",
        level=SkillLevel.INTERMEDIATE
    )


@pytest.fixture
def sample_log():
    """Create a sample daily log for testing."""
    return DailyLog(
        id="log_test_001",
        skill_id="skill_test_001",
        date=date(2024, 1, 15),
        duration_minutes=60,
        notes="Test session",
        rating=4
    )


class TestInMemorySkillStorage:
    """Test cases for InMemorySkillStorage."""

    @pytest.mark.asyncio
    async def test_create_skill(self, sample_skill):
        """Test creating a new skill."""
        storage = InMemorySkillStorage()
        
        result = await storage.create(sample_skill)
        
        assert result.id == sample_skill.id
        assert result.name == sample_skill.name
        
        # Verify it can be retrieved
        retrieved = await storage.get_by_id(sample_skill.id)
        assert retrieved is not None
        assert retrieved.id == sample_skill.id

    @pytest.mark.asyncio
    async def test_create_duplicate_skill(self, sample_skill):
        """Test that creating a duplicate skill raises error."""
        storage = InMemorySkillStorage()
        
        await storage.create(sample_skill)
        
        with pytest.raises(DuplicateError):
            await storage.create(sample_skill)

    @pytest.mark.asyncio
    async def test_get_by_id_not_found(self):
        """Test getting a non-existent skill."""
        storage = InMemorySkillStorage()
        
        result = await storage.get_by_id("nonexistent")
        
        assert result is None

    @pytest.mark.asyncio
    async def test_get_all(self, sample_skill):
        """Test retrieving all skills."""
        storage = InMemorySkillStorage()
        
        await storage.create(sample_skill)
        skill2 = Skill(id="skill_002", name="Another Skill")
        await storage.create(skill2)
        
        all_skills = await storage.get_all()
        
        assert len(all_skills) == 2
        ids = {s.id for s in all_skills}
        assert "skill_test_001" in ids
        assert "skill_002" in ids

    @pytest.mark.asyncio
    async def test_update_skill(self, sample_skill):
        """Test updating an existing skill."""
        storage = InMemorySkillStorage()
        await storage.create(sample_skill)
        
        # Modify and update
        sample_skill.name = "Updated Skill Name"
        updated = await storage.update(sample_skill)
        
        assert updated.name == "Updated Skill Name"
        
        # Verify persistence
        retrieved = await storage.get_by_id(sample_skill.id)
        assert retrieved.name == "Updated Skill Name"

    @pytest.mark.asyncio
    async def test_update_nonexistent_skill(self, sample_skill):
        """Test updating a non-existent skill raises error."""
        storage = InMemorySkillStorage()
        
        with pytest.raises(NotFoundError):
            await storage.update(sample_skill)

    @pytest.mark.asyncio
    async def test_delete_skill(self, sample_skill):
        """Test deleting a skill."""
        storage = InMemorySkillStorage()
        await storage.create(sample_skill)
        
        result = await storage.delete(sample_skill.id)
        
        assert result is True
        assert await storage.get_by_id(sample_skill.id) is None

    @pytest.mark.asyncio
    async def test_delete_nonexistent_skill(self):
        """Test deleting a non-existent skill returns False."""
        storage = InMemorySkillStorage()
        
        result = await storage.delete("nonexistent")
        
        assert result is False

    @pytest.mark.asyncio
    async def test_get_by_level(self, sample_skill):
        """Test filtering skills by level."""
        storage = InMemorySkillStorage()
        
        beginner = Skill(id="skill_beg", name="Beginner Skill", level=SkillLevel.BEGINNER)
        expert = Skill(id="skill_exp", name="Expert Skill", level=SkillLevel.EXPERT)
        
        await storage.create(sample_skill)  # INTERMEDIATE
        await storage.create(beginner)
        await storage.create(expert)
        
        intermediate_skills = await storage.get_by_level("intermediate")
        assert len(intermediate_skills) == 1
        assert intermediate_skills[0].id == "skill_test_001"
        
        beginner_skills = await storage.get_by_level("beginner")
        assert len(beginner_skills) == 1
        
        invalid_level = await storage.get_by_level("invalid")
        assert len(invalid_level) == 0


class TestInMemoryDailyLogStorage:
    """Test cases for InMemoryDailyLogStorage."""

    @pytest.mark.asyncio
    async def test_create_log(self, sample_log):
        """Test creating a new log."""
        storage = InMemoryDailyLogStorage()
        
        result = await storage.create(sample_log)
        
        assert result.id == sample_log.id
        assert result.duration_minutes == 60

    @pytest.mark.asyncio
    async def test_get_by_skill_id(self, sample_log):
        """Test retrieving logs by skill ID."""
        storage = InMemoryDailyLogStorage()
        
        await storage.create(sample_log)
        log2 = DailyLog(
            id="log_002",
            skill_id="skill_test_001",
            duration_minutes=30
        )
        await storage.create(log2)
        
        logs = await storage.get_by_skill_id("skill_test_001")
        
        assert len(logs) == 2

    @pytest.mark.asyncio
    async def test_get_by_date_range(self, sample_log):
        """Test retrieving logs within a date range."""
        storage = InMemoryDailyLogStorage()
        
        await storage.create(sample_log)
        log2 = DailyLog(
            id="log_002",
            skill_id="skill_test_001",
            date=date(2024, 1, 20),
            duration_minutes=45
        )
        await storage.create(log2)
        
        logs = await storage.get_by_date_range(
            "skill_test_001",
            date(2024, 1, 1),
            date(2024, 1, 18)
        )
        
        assert len(logs) == 1
        assert logs[0].id == "log_test_001"

    @pytest.mark.asyncio
    async def test_delete_log(self, sample_log):
        """Test deleting a log."""
        storage = InMemoryDailyLogStorage()
        await storage.create(sample_log)
        
        result = await storage.delete(sample_log.id)
        
        assert result is True
        assert await storage.get_by_id(sample_log.id) is None


class TestInMemoryUnitOfWork:
    """Test cases for InMemoryUnitOfWork."""

    @pytest.mark.asyncio
    async def test_unit_of_work_context_manager(self, sample_skill):
        """Test using unit of work as context manager."""
        async with InMemoryUnitOfWork() as uow:
            await uow.skills.create(sample_skill)
            skill = await uow.skills.get_by_id(sample_skill.id)
            assert skill is not None

    @pytest.mark.asyncio
    async def test_unit_of_work_commit(self, sample_skill):
        """Test committing changes in unit of work."""
        uow = InMemoryUnitOfWork()
        
        async with uow:
            await uow.skills.create(sample_skill)
            await uow.commit()
        
        assert uow._committed is True

    @pytest.mark.asyncio
    async def test_unit_of_work_properties(self):
        """Test that unit of work provides access to storages."""
        async with InMemoryUnitOfWork() as uow:
            assert uow.skills is not None
            assert uow.logs is not None
            assert isinstance(uow.skills, InMemorySkillStorage)
            assert isinstance(uow.logs, InMemoryDailyLogStorage)


class TestInMemoryStorageProvider:
    """Test cases for InMemoryStorageProvider factory."""

    def test_create_unit_of_work(self):
        """Test creating unit of work via provider."""
        uow = InMemoryStorageProvider.create_unit_of_work()
        
        assert isinstance(uow, InMemoryUnitOfWork)

    def test_create_skill_storage(self):
        """Test creating standalone skill storage."""
        storage = InMemoryStorageProvider.create_skill_storage()
        
        assert isinstance(storage, InMemorySkillStorage)

    def test_create_log_storage(self):
        """Test creating standalone log storage."""
        storage = InMemoryStorageProvider.create_log_storage()
        
        assert isinstance(storage, InMemoryDailyLogStorage)
