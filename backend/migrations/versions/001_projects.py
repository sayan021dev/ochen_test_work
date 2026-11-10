"""Projects, optimistic revisions and persisted daily AI quotas."""

import sqlalchemy as sa
from alembic import op

revision = "001"
down_revision = None


def upgrade():
    op.create_table(
        "projects",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner", sa.String(64), nullable=False),
        sa.Column("scene", sa.JSON(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_projects_owner", "projects", ["owner"])
    op.create_table(
        "ai_budget",
        sa.Column("id", sa.String(100), primary_key=True),
        sa.Column("count", sa.Integer(), nullable=False),
    )


def downgrade():
    op.drop_table("ai_budget")
    op.drop_index("ix_projects_owner", "projects")
    op.drop_table("projects")
