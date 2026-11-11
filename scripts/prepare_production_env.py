"""First deployment only: collect secrets in a real terminal, never in shell history."""

import argparse
import getpass
import json
import os
import secrets
import sys
from pathlib import Path


def build_values(password: str, api_key: str, proxy: str, port: int) -> dict[str, str]:
    if not 12 <= len(password) <= 4096 or any(ord(c) < 32 for c in password + api_key + proxy):
        raise ValueError("Нужен пароль от 12 символов; управляющие символы недопустимы.")
    if not 1024 <= port <= 65535:
        raise ValueError("Нужен свободный непривилегированный порт 1024–65535.")
    return {
        "OCHEN_APP_PORT": str(port),
        "POSTGRES_PASSWORD": secrets.token_hex(32),
        "SITE_PASSWORD": password,
        "AUTH_SECRET": secrets.token_hex(32),
        "OPENAI_API_KEY": api_key,
        "HTTP_PROXY": proxy,
        "OPENAI_MODEL": "gpt-6-luna",
        "ALLOWED_ORIGINS": '["https://true-4.ru"]',
        "REQUIRE_SITE_PASSWORD": "true",
        "COOKIE_SECURE": "true",
        "CUSTOM_SHADOWS_ENABLED": "true",
        "AI_REQUEST_LIMIT": "100",
        "AI_SESSION_LIMIT": "20",
    }


def write_env(path: Path, values: dict[str, str]):
    # Compose parses double-quoted escapes; $$ prevents variable interpolation.
    lines = [
        f"{key}={json.dumps(value.replace('$', '$$'), ensure_ascii=False)}\n"
        for key, value in values.items()
    ]
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as output:
        output.writelines(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path(".env.production"))
    parser.add_argument("--port", type=int, default=18017)
    args = parser.parse_args()
    if not sys.stdin.isatty() or not sys.stderr.isatty():
        parser.error("Запустите непосредственно в терминале Termius, без pipe/перенаправления.")
    if args.output.exists():
        parser.error("Файл уже существует: обновляйте его отдельно, сохраняя секреты и БД.")
    print("Сложено · production. Ввод скрыт. Секреты не отправляйте в чат.")
    password = getpass.getpass("Пароль редактора и Swagger (от 12 символов): ")
    confirmation = getpass.getpass("Повторите пароль: ")
    if not secrets.compare_digest(password.encode(), confirmation.encode()):
        parser.error("Пароли не совпадают; файл не создан.")
    api_key = getpass.getpass("OPENAI_API_KEY (Enter — настроить позднее): ")
    proxy = getpass.getpass("HTTP_PROXY для OpenAI (Enter — прямое соединение): ")
    try:
        write_env(args.output, build_values(password, api_key, proxy, args.port))
    except (ValueError, FileExistsError) as error:
        parser.error(str(error))
    print("PRODUCTION_ENV_READY · права 0600 · значения скрыты")


if __name__ == "__main__":
    main()
