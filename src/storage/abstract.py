"""
Storage layer abstraction for the V2 architecture.

This module defines abstract base classes for storage operations,
allowing for multiple backend implementations (in-memory, SQLite, etc.).
"""

from abc import ABC, abstractmethod
from typing import Optional, List, TypeVar, Generic, Protocol
from datetime import date

from src.models.skill_models import Skill, DailyLog


T = TypeVar('T')


class StorageError(Exception):
    """Base exception for storage-related errors."""
    pass


class NotFoundError(StorageError):
    """Raised when a requested entity is not found."""
    pass


class DuplicateError(StorageError):
    """Raised when attempting to create a duplicate entity."""
    pass


class SkillStorage(ABC):
    """
    Abstract base class for Skill storage operations.
    
    Implementations should provide concrete storage mechanisms
    while adhering to this interface.
    """

    @abstractmethod
    async def create(self, skill: Skill) -> Skill:
        """Create a new skill record."""
        pass

    @abstractmethod
    async def get_by_id(self, skill_id: str) -> Optional[Skill]:
        """Retrieve a skill by its unique ID."""
        pass

    @abstractmethod
    async def get_all(self) -> List[Skill]:
        """Retrieve all skills."""
        pass

    @abstractmethod
    async def update(self, skill: Skill) -> Skill:
        """Update an existing skill record."""
        pass

    @abstractmethod
    async def delete(self, skill_id: str) -> bool:
        """Delete a skill by ID. Returns True if deleted, False if not found."""
        pass

    @abstractmethod
    async def get_by_level(self, level: str) -> List[Skill]:
        """Retrieve skills filtered by proficiency level."""
        pass


class DailyLogStorage(ABC):
    """
    Abstract base class for DailyLog storage operations.
    """

    @abstractmethod
    async def create(self, log: DailyLog) -> DailyLog:
        """Create a new daily log record."""
        pass

    @abstractmethod
    async def get_by_id(self, log_id: str) -> Optional[DailyLog]:
        """Retrieve a log by its unique ID."""
        pass

    @abstractmethod
    async def get_by_skill_id(self, skill_id: str) -> List[DailyLog]:
        """Retrieve all logs for a specific skill."""
        pass

    @abstractmethod
    async def get_by_date_range(
        self, 
        skill_id: str, 
        start_date: date, 
        end_date: date
    ) -> List[DailyLog]:
        """Retrieve logs for a skill within a date range."""
        pass

    @abstractmethod
    async def update(self, log: DailyLog) -> DailyLog:
        """Update an existing log record."""
        pass

    @abstractmethod
    async def delete(self, log_id: str) -> bool:
        """Delete a log by ID. Returns True if deleted, False if not found."""
        pass


class UnitOfWork(ABC):
    """
    Unit of Work pattern for transactional operations.
    
    Ensures that related operations are executed atomically.
    """

    @abstractmethod
    async def __aenter__(self) -> 'UnitOfWork':
        """Enter the transaction context."""
        pass

    @abstractmethod
    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """Exit the transaction context, committing or rolling back."""
        pass

    @abstractmethod
    async def commit(self) -> None:
        """Commit all pending changes."""
        pass

    @abstractmethod
    async def rollback(self) -> None:
        """Rollback all pending changes."""
        pass

    @property
    @abstractmethod
    def skills(self) -> SkillStorage:
        """Get the skill storage instance."""
        pass

    @property
    @abstractmethod
    def logs(self) -> DailyLogStorage:
        """Get the daily log storage instance."""
        pass
