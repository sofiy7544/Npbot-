"""Computer Control — диагностика и БЕЗОПАСНОЕ управление ПК."""
from .info import collect, quick_summary
from .control import ComputerControl, SafetyError

__all__ = ["collect", "quick_summary", "ComputerControl", "SafetyError"]
