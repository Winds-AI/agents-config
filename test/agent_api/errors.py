from __future__ import annotations

from dataclasses import dataclass


@dataclass
class AgentApiError(Exception):
    code: str
    message: str
    suggested_fix: str | None = None

    def __str__(self) -> str:
        return f"{self.code}: {self.message}"
