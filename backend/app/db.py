from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import JSON, DateTime, Integer, String, create_engine, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Project(Base):
    __tablename__ = "projects"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    owner: Mapped[str] = mapped_column(String(64), index=True)
    scene: Mapped[dict] = mapped_column(JSON)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


class Budget(Base):
    __tablename__ = "ai_budget"
    id: Mapped[str] = mapped_column(String(100), primary_key=True)
    count: Mapped[int] = mapped_column(Integer, default=0)


def make_engine(url: str):
    return create_engine(
        url,
        pool_pre_ping=True,
        connect_args={"check_same_thread": False} if url.startswith("sqlite") else {},
    )


class BudgetExceeded(ValueError):
    pass


def reserve_ai_request(engine, owner: str, global_limit: int, session_limit: int):
    """Atomic persisted daily caps, including requests that fail upstream."""
    day = datetime.now(UTC).date().isoformat()
    insert = sqlite_insert if engine.dialect.name == "sqlite" else pg_insert
    with engine.begin() as connection:
        for identifier, limit in [
            (f"{day}:global", global_limit),
            (f"{day}:{owner}", session_limit),
        ]:
            connection.execute(
                insert(Budget).values(id=identifier, count=0).on_conflict_do_nothing()
            )
            result = connection.execute(
                update(Budget)
                .where(Budget.id == identifier, Budget.count < limit)
                .values(count=Budget.count + 1)
                .returning(Budget.count)
            ).scalar_one_or_none()
            if result is None:
                raise BudgetExceeded(
                    "Дневной лимит AI-подбора исчерпан. Редактор и поиск доступны."
                )
