"""
In-memory storage implementation for testing and development.

This module provides a concrete implementation of the storage abstraction
using in-memory data structures, suitable for testing and prototyping.
"""

import asyncio
from typing import Dict, List, Optional
from datetime import date
from copy import deepcopy

from src.models.skill_models import Skill, DailyLog, SkillLevel
from src.storage.abstract import (
    SkillStorage,
    DailyLogStorage,
    UnitOfWork,
    NotFoundError,
    DuplicateError,
    StorageError,
)


class InMemorySkillStorage(SkillStorage):
    """
    In-memory implementation of SkillStorage.
    
    Uses a dictionary for fast lookups and supports async operations
    by simulating database latency.
    """

    def __init__(self, data: Optional[Dict[str, Skill]] = None):
        self._data: Dict[str, Skill] = data or {}
        self._lock = asyncio.Lock()

    async def create(self, skill: Skill) -> Skill:
        async with self._lock:
            if skill.id in self._data:
                raise DuplicateError(f"Skill with id '{skill.id}' already exists")
            self._data[skill.id] = deepcopy(skill)
            return deepcopy(skill)

    async def get_by_id(self, skill_id: str) -> Optional[Skill]:
        await asyncio.sleep(0)  # Simulate async operation
        skill = self._data.get(skill_id)
        return deepcopy(skill) if skill else None

    async def get_all(self) -> List[Skill]:
        await asyncio.sleep(0)
        return [deepcopy(s) for s in self._data.values()]

    async def update(self, skill: Skill) -> Skill:
        async with self._lock:
            if skill.id not in self._data:
                raise NotFoundError(f"Skill with id '{skill.id}' not found")
            self._data[skill.id] = deepcopy(skill)
            return deepcopy(skill)

    async def delete(self, skill_id: str) -> bool:
        async with self._lock:
            if skill_id not in self._data:
                return False
            del self._data[skill_id]
            return True

    async def get_by_level(self, level: str) -> List[Skill]:
        await asyncio.sleep(0)
        try:
            target_level = SkillLevel(level)
            return [deepcopy(s) for s in self._data.values() if s.level == target_level]
        except ValueError:
            return []


class InMemoryDailyLogStorage(DailyLogStorage):
    """
    In-memory implementation of DailyLogStorage.
    """

    def __init__(self, data: Optional[Dict[str, DailyLog]] = None):
        self._data: Dict[str, DailyLog] = data or {}
        self._lock = asyncio.Lock()

    async def create(self, log: DailyLog) -> DailyLog:
        async with self._lock:
            if log.id in self._data:
                raise DuplicateError(f"Log with id '{log.id}' already exists")
            self._data[log.id] = deepcopy(log)
            return deepcopy(log)

    async def get_by_id(self, log_id: str) -> Optional[DailyLog]:
        await asyncio.sleep(0)
        log = self._data.get(log_id)
        return deepcopy(log) if log else None

    async def get_by_skill_id(self, skill_id: str) -> List[DailyLog]:
        await asyncio.sleep(0)
        return [
            deepcopy(log) for log in self._data.values()
            if log.skill_id == skill_id
        ]

    async def get_by_date_range(
        self,
        skill_id: str,
        start_date: date,
        end_date: date
    ) -> List[DailyLog]:
        await asyncio.sleep(0)
        return [
            deepcopy(log) for log in self._data.values()
            if log.skill_id == skill_id and start_date <= log.date <= end_date
        ]

    async def update(self, log: DailyLog) -> DailyLog:
        async with self._lock:
            if log.id not in self._data:
                raise NotFoundError(f"Log with id '{log.id}' not found")
            self._data[log.id] = deepcopy(log)
            return deepcopy(log)

    async def delete(self, log_id: str) -> bool:
        async with self._lock:
            if log_id not in self._data:
                return False
            del self._data[log_id]
            return True


class InMemoryUnitOfWork(UnitOfWork):
    """
    In-memory implementation of UnitOfWork pattern.
    
    Provides transactional semantics for in-memory operations.
    """

    def __init__(self):
        self._skills = InMemorySkillStorage()
        self._logs = InMemoryDailyLogStorage()
        self._committed = False
        self._rolled_back = False

    async def __aenter__(self) -> 'InMemoryUnitOfWork':
        self._committed = False
        self._rolled_back = False
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        if exc_type is not None and not self._committed:
            await self.rollback()
        elif not self._committed and not self._rolled_back:
            await self.commit()

    async def commit(self) -> None:
        """Commit changes (in memory, this is a no-op but marks state)."""
        self._committed = True

    async def rollback(self) -> None:
        """Rollback changes (clear all data for simplicity)."""
        self._rolled_back = True
        # In a real implementation, we would restore from a snapshot
        # For testing, we just mark the state

    @property
    def skills(self) -> InMemorySkillStorage:
        return self._skills

    @property
    def logs(self) -> InMemoryDailyLogStorage:
        return self._logs


class InMemoryStorageProvider:
    """
    Factory class for creating in-memory storage instances.
    
    Provides a convenient way to get pre-configured storage components.
    """

    @staticmethod
    def create_unit_of_work() -> InMemoryUnitOfWork:
        """Create a new unit of work instance."""
        return InMemoryUnitOfWork()

    @staticmethod
    def create_skill_storage() -> InMemorySkillStorage:
        """Create a standalone skill storage instance."""
        return InMemorySkillStorage()

    @staticmethod
    def create_log_storage() -> InMemoryDailyLogStorage:
        """Create a standalone log storage instance."""
        return InMemoryDailyLogStorage()
