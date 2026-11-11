FROM node:22-alpine AS frontend
WORKDIR /ui
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
ARG GIT_REVISION=development
LABEL org.opencontainers.image.revision=$GIT_REVISION
LABEL org.opencontainers.image.source="https://github.com/sayan021dev/ochen_test_work"
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/app/backend
WORKDIR /app
COPY requirements.lock ./
RUN pip install --no-cache-dir -r requirements.lock
COPY backend/ backend/
COPY assets/ assets/
COPY alembic.ini ./
COPY --from=frontend /ui/dist frontend/dist
RUN useradd --uid 10001 --create-home illustration
USER illustration
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
