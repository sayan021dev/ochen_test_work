# Выпуск на true-4.ru

Статус: V1 развёрнута на [true-4.ru](https://true-4.ru) 11 ноября 2026.
Это воспроизводимая инструкция; конкретные SHA/images, backup и наблюдавшиеся
результаты выпуска зафиксированы отдельно в [RELEASE.md](RELEASE.md).

## Размещение и изоляция

- Доступ: Termius, сохранённый хост **T2T Ivan server**. Перед любыми изменениями
  сверить `hostname` и пользователя с выбранным хостом; занятый терминал не использовать.
- Отдельный checkout `/opt/slozheno`, Compose-проект `slozheno-prod`.
- Только `compose.production.yaml`; не объединять его с локальным `compose.yaml`.
- Web слушает `127.0.0.1:18017`; PostgreSQL не публикует порт, находится во внутренней
  сети `slozheno-prod_backend`, volume `slozheno-prod_postgres-data`.
- Общий edge Nginx подключается к `slozheno-prod_edge`, upstream `slozheno-web:8000`.
  Его имя/путь конфигурации устанавливаются текущим `docker inspect`, не угадываются.
- Домен `true-4.ru`, HTTPS, существующий ACME webroot `/var/www/certbot`.
  Новый reverse proxy на портах 80/443 не запускается.

При первом выпуске добавить внешнюю сеть `slozheno-prod_edge` в декларативную
конфигурацию только edge-сервиса, сохранив все остальные поля/сервисы. Перед записью
сделать защищённую копию; выполнить `compose config --quiet`. Уже работающий edge
подключается без пересоздания. После его будущего пересоздания снова проверить сеть.
При необходимости подключить только этот контейнер командой
`docker network connect slozheno-prod_edge <EDGE_CONTAINER>`. При обычном обновлении
web Nginx пересоздавать не нужно: DNS upstream обновляется через Docker resolver.

## Секреты и первый запуск

Сначала проверить DNS A/AAAA, свободный порт, место, текущие контейнеры и отсутствие
чужих изменений в каталоге проекта. Скачать публичный репозиторий, выбрать проверенный
SHA из main. Не переносить `.env` других проектов.

Пользователь запускает/завершает скрытую форму непосредственно в Termius:

```bash
cd /opt/slozheno
python3 scripts/prepare_production_env.py --port 18017
```

Форма дважды запрашивает пароль редактора/Swagger, затем ключ OpenAI и HTTPS-прокси.
Ввод не отображается и не попадает в историю команд. Enter на ключе оставляет
AI ненастроенным; для полноценного подбора по идее ключ и прокси нужно заполнить.
Создаётся только новый `.env.production` с правами `0600`; существующий не заменяется.
Пароль БД и стабильный `AUTH_SECRET` генерируются автоматически. Не выводить файл,
`docker inspect` с Environment или полный `compose config` в чат/публичный лог.

В production жёстко включены `REQUIRE_SITE_PASSWORD=true`, `COOKIE_SECURE=true`,
origin `https://true-4.ru`. Compose не запускается с пустыми паролем/секретом/паролем БД.
Экранирование env проверяется настоящим Compose: символы `$`, кавычки и обратные
слеши не должны менять введённые значения. Формат следует [правилам Compose](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/).

```bash
export RELEASE_SHA="$(git rev-parse HEAD)"
docker compose --env-file .env.production -f compose.production.yaml config --quiet
docker compose --env-file .env.production -f compose.production.yaml build web
docker compose --env-file .env.production -f compose.production.yaml up -d --wait
```

Entrypoint применяет Alembic перед стартом API. `up --wait` проверяет БД и настоящий
`/api/ready`. Image называется `slozheno-web:<SHA>` и имеет OCI revision label.
Локальный HTTP-порт нужен для health, а вход с Secure-cookie проверяется через HTTPS.

## Edge и TLS

До изменения общего edge сохранить его текущую конфигурацию с владельцем/правами
в закрытом каталоге backup (`0700`). Менять только блок между маркерами
`BEGIN SLOZHENO true-4.ru` / `END SLOZHENO true-4.ru`; остальные домены сохранить.
У файлового bind mount сохранять inode: запись на месте, не rename поверх mount.

1. Добавить [bootstrap HTTP](../deploy/nginx-http.conf): ACME challenge доступен,
   приложение пока возвращает 503. Проверить `nginx -t`, выполнить graceful reload.
2. Получить сертификат `true-4.ru` существующим Certbot с теми же volumes/webroot.
   Договор/контакт ACME использует уже настроенный оператором аккаунт.
3. После готовности приложения и пароля заменить наш блок на
   [HTTPS-конфигурацию](../deploy/nginx-https.conf), снова `nginx -t` и reload.
4. Проверить certificate SAN/expiry, HTTP→HTTPS и автоматическое продление.
   При ошибке синтаксиса восстановить backup до reload; другие сайты не перезапускать.

На этом сервере существующий Certbot выполняет renew в цикле. Для подхвата нового
сертификата предусмотрены [helper](../deploy/slozheno-tls-reload.sh),
[service](../deploy/slozheno-tls-reload.service) и [timer](../deploy/slozheno-tls-reload.timer).
Helper устанавливается root в `/usr/local/sbin/slozheno-tls-reload` с правами `0755`,
units — в `/etc/systemd/system`. Проверить `bash -n`, `systemd-analyze verify`,
затем `systemctl daemon-reload` и `systemctl enable --now slozheno-tls-reload.timer`.
Контрольный запуск service должен завершиться с кодом 0. Дважды в сутки timer сравнивает
SHA256 сертификата со stamp в `/var/lib/slozheno-tls`; graceful reload выполняется
только при изменении файла и после успешного `nginx -t`. Паролей в helper/units нет.

## Доступ и smoke после выпуска

Пароль вводится на главной странице. Затем в этом же браузере доступны `/docs`,
`/redoc`, `/openapi.json`. Без входа API, библиотека и документация возвращают 401.
`/api/auth`, вход/выход и `/api/health`, `/api/ready` публичны намеренно; они не раскрывают
проекты, ключи или каталог. Cookie HttpOnly/Secure/SameSite=Lax, вход на 8 часов.
Смена пароля аннулирует прежний вход. Проекты разных браузерных сессий изолированы.

```bash
curl --fail https://true-4.ru/api/ready
curl -s -o /dev/null -w '%{http_code}\n' https://true-4.ru/docs
curl -s -o /dev/null -w '%{http_code}\n' https://true-4.ru/openapi.json
docker compose --env-file .env.production -f compose.production.yaml ps
docker compose --env-file .env.production -f compose.production.yaml logs --tail 30 web
```

Ожидания: readiness 200, анонимные docs/schema 401. Дополнительно сверить revision
label **работающего** image с `RELEASE_SHA`, БД/миграцию, UI входа, авторизованный
Swagger, создание/сохранение/reload, обычный/экспериментальный SVG и палитру.
Платный AI smoke запускать осознанно, отдельно от health. Не создавать искусственно
массовые запросы на публичном AI endpoint. Лимиты UTC: 100/сутки всего, 20/сессию.

## Обновления, backup и откат

До обновления записать текущие checkout SHA, running image ID/revision, сеть и mounts.
В закрытом backup-каталоге сохранить `.env.production`, Compose/edge-конфиги и дамп:

```bash
umask 077
# BACKUP_DIR — заранее созданный закрытый каталог вне checkout.
docker compose --env-file .env.production -f compose.production.yaml exec -T db \
  pg_dump -U illustrations -d illustrations -Fc > "$BACKUP_DIR/database.dump"
docker compose --env-file .env.production -f compose.production.yaml exec -T db \
  pg_restore --list < "$BACKUP_DIR/database.dump" > /dev/null
```

Проверить exit codes, непустой файл и оглавление; не считать перенаправление доказательством
успешного backup. Сохранять прежний image локально, не выполнять image/volume prune.
Для обновления fetch/fast-forward или отдельный чистый release checkout; dirty tree
не сбрасывать. Затем build/up только нашего web, сверка версии и health.

Откат приложения: установить `RELEASE_SHA` прежнего image и выполнить
`docker compose --env-file .env.production -f compose.production.yaml up -d --no-build --no-deps web`.
Production env/БД сохраняются. При изменении схемы сначала проверить совместимость;
автоматически восстанавливать старый дамп нельзя — это потеряет новые проекты.
Для первого запуска прежнего приложения нет: откат означает остановку нашего web
и возврат нашего domain-блока к 503, с сохранением volume и backup. `down -v` запрещён.
