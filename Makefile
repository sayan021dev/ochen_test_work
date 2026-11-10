.PHONY: install dev db test check e2e
install:
	python3.12 -m venv .venv
	.venv/bin/pip install -r requirements.lock
	npm ci --prefix frontend
db:
	docker compose up -d --wait db
	.venv/bin/alembic upgrade head
dev:
	bash scripts/dev.sh
test:
	.venv/bin/pytest --cov=app --cov-branch --cov-report=term-missing
	npm --prefix frontend test
check: test
	.venv/bin/ruff check backend scripts
	.venv/bin/ruff format --check backend scripts
	npm --prefix frontend run lint
	npm --prefix frontend run build
e2e: db
	cd frontend && npx playwright test
