"""
store.py — долговременная и семантическая память.

Факты/предпочтения/события хранятся в SQLite (таблица memories). Для поиска «по
смыслу» к каждой записи считается эмбеддинг (через AIProvider) и хранится как
BLOB; при поиске берём эмбеддинг запроса и ранжируем косинусной близостью в
numpy. Без ключа/провайдера работает запасной поиск по ключевым словам.

Почему так, а не Qdrant: на целевом ПК (4 ГБ ОЗУ) отдельный векторный сервис
не нужен — для личных объёмов (тысячи записей) брутфорс-косинус в numpy мгновенный.
"""
from __future__ import annotations

import time
import numpy as np

from ..core.interfaces import MemoryStore, MemoryItem, AIProvider


def _to_blob(vec: list[float]) -> bytes:
    return np.asarray(vec, dtype=np.float32).tobytes()


def _from_blob(blob: bytes) -> np.ndarray:
    return np.frombuffer(blob, dtype=np.float32)


def _normalize(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v)
    return v / n if n else v


class SQLiteMemory(MemoryStore):
    def __init__(self, db, provider: AIProvider | None = None,
                 embed_model: str = "text-embedding-3-small"):
        self.db = db
        self.provider = provider
        self.embed_model = embed_model

    def _embed(self, text: str) -> list[float] | None:
        if not (self.provider and self.provider.available()):
            return None
        try:
            return self.provider.embed([text], model=self.embed_model)[0]
        except Exception:
            return None

    # ----------------------- запись -----------------------
    def remember(self, user_id: int, content: str, *, kind: str = "fact",
                 importance: int = 1, expires_at: float | None = None) -> int:
        content = (content or "").strip()
        if not content:
            return 0
        now = time.time()
        emb = self._embed(content)
        return self.db.insert("memories", {
            "user_id": user_id, "kind": kind, "content": content,
            "embedding": _to_blob(emb) if emb else None,
            "importance": int(importance), "expires_at": expires_at,
            "created_at": now, "updated_at": now,
        })

    def update(self, user_id: int, memory_id: int, content: str) -> bool:
        emb = self._embed(content)
        n = self.db.execute(
            "UPDATE memories SET content=?, embedding=?, updated_at=? "
            "WHERE id=? AND user_id=?",
            (content, _to_blob(emb) if emb else None, time.time(), memory_id, user_id))
        return True

    def forget(self, user_id: int, memory_id: int) -> bool:
        before = self.db.query_one(
            "SELECT 1 FROM memories WHERE id=? AND user_id=?", (memory_id, user_id))
        self.db.execute("DELETE FROM memories WHERE id=? AND user_id=?",
                        (memory_id, user_id))
        return before is not None

    def wipe(self, user_id: int) -> int:
        rows = self.db.query("SELECT COUNT(*) AS c FROM memories WHERE user_id=?", (user_id,))
        self.db.execute("DELETE FROM memories WHERE user_id=?", (user_id,))
        return rows[0]["c"] if rows else 0

    # ----------------------- чтение/поиск -----------------------
    def _live_rows(self, user_id: int):
        now = time.time()
        return self.db.query(
            "SELECT * FROM memories WHERE user_id=? AND (expires_at IS NULL OR expires_at>?)",
            (user_id, now))

    def recent(self, user_id: int, *, limit: int = 20) -> list[MemoryItem]:
        rows = self.db.query(
            "SELECT * FROM memories WHERE user_id=? AND (expires_at IS NULL OR expires_at>?) "
            "ORDER BY created_at DESC LIMIT ?", (user_id, time.time(), limit))
        return [self._item(r) for r in rows]

    def search(self, user_id: int, query: str, *, limit: int = 5) -> list[MemoryItem]:
        rows = self._live_rows(user_id)
        if not rows:
            return []
        q_emb = self._embed(query)
        have_vectors = [r for r in rows if r["embedding"]]

        if q_emb is not None and have_vectors:
            qv = _normalize(np.asarray(q_emb, dtype=np.float32))
            scored, mismatched = [], []
            for r in have_vectors:
                v = _normalize(_from_blob(r["embedding"]))
                if v.shape != qv.shape:
                    # модель эмбеддингов сменили → размерность не совпала.
                    # Не теряем запись: отправим её в keyword-фолбэк.
                    mismatched.append(r)
                    continue
                sim = float(np.dot(qv, v))
                scored.append((sim, r))
            scored.sort(key=lambda x: x[0], reverse=True)
            items = [self._item(r, score=s) for s, r in scored[:limit]]
            if len(items) < limit:
                # добираем из записей без вектора + из «другой размерности»
                leftover = [r for r in rows if not r["embedding"]] + mismatched
                items += self._keyword_search(query, leftover, limit - len(items))
            return items[:limit]

        # запасной поиск по ключевым словам (без эмбеддингов)
        return self._keyword_search(query, rows, limit)

    def _keyword_search(self, query: str, rows, limit: int) -> list[MemoryItem]:
        words = [w for w in query.lower().split() if len(w) > 2]
        scored = []
        for r in rows:
            text = r["content"].lower()
            hits = sum(1 for w in words if w in text)
            if hits:
                scored.append((hits + 0.1 * r["importance"], r))
        scored.sort(key=lambda x: x[0], reverse=True)
        return [self._item(r, score=s) for s, r in scored[:limit]]

    @staticmethod
    def _item(r, score: float | None = None) -> MemoryItem:
        return MemoryItem(id=r["id"], user_id=r["user_id"], kind=r["kind"],
                          content=r["content"], importance=r["importance"], score=score)
