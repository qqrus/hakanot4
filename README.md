# CollabCode AI

Hackathon-ready MVP браузерной платформы для совместного редактирования кода в реальном времени с AI reviewer и общим запуском Python.

## Короткий план реализации

1. Собрать монорепо с отдельными пакетами для `web`, `server`, `shared`, `sandbox`.
2. Реализовать WebSocket-комнаты и общее состояние сессии.
3. Подключить Monaco + Yjs для совместного редактирования и удаленных курсоров.
4. Добавить mock AI reviewer по diff и общий терминал исполнения.
5. Подготовить Docker sandbox, демо-данные и README для локального запуска.

## Что уже работает

- Совместный редактор на Monaco Editor
- CRDT-синхронизация документа через Yjs
- Удаленные курсоры и selections через Yjs awareness
- WebSocket-комнаты с reconnect на клиенте
- Общий event feed и список участников
- Общий терминал со стримингом stdout/stderr
- Запуск Python через Docker container с CPU/memory/time limits
- Diff-based mock AI reviewer с structured suggestions
- Предзагруженная demo room и sample code

## Структура проекта

```text
.
├─ apps/
│  ├─ server/              # Express + WebSocket collaboration server
│  └─ web/                 # Next.js client with Monaco + Yjs
├─ packages/
│  └─ shared/              # Shared TypeScript types and contracts
├─ sandbox/
│  └─ python-runner/       # Docker image for Python execution
├─ demo/
│  └─ sample-ai-suggestions.json
├─ docker-compose.yml      # PostgreSQL for local setup
└─ .env.example
```

## Архитектура

### Frontend

- `Next.js App Router` для UI и маршрута комнаты `/room/[roomId]`
- `Monaco Editor` как основной IDE-экран
- `Yjs + y-monaco` для синхронизации текста без конфликтов
- `Awareness` для удаленных курсоров и выделений
- Правая панель для участников, AI review, событий и shared terminal

### Backend

- `Express` для REST bootstrap endpoint и healthcheck
- `ws` для real-time room transport
- In-memory room state для стабильного hackathon demo
- Mock AI service, который анализирует diff и возвращает структурированные рекомендации
- Docker sandbox runner для Python исполнения

### Shared contracts

- Общие TypeScript-типы для room snapshot, suggestions, terminal, websocket messages

### Database

- `PostgreSQL` поднимается через `docker-compose`
- Есть отдельные скрипты инициализации и seed для demo room
- Для MVP live collaboration хранится в памяти сервера, чтобы уменьшить сложность демо и улучшить стабильность

## Быстрый старт

### 1. Установить зависимости

```bash
npm install
```

### 2. Поднять PostgreSQL

```bash
docker compose up -d
```

### 3. Скопировать переменные окружения

```bash
copy .env.example .env
```

Если вы не на Windows:

```bash
cp .env.example .env
```

### 4. Собрать Docker-образ sandbox

```bash
docker build -t collabcode-python-runner:latest ./sandbox/python-runner
```

### 5. Инициализировать БД и demo room

```bash
npm run db:init
npm run seed
```

### 6. Запустить приложение

```bash
npm run dev
```

После запуска:

- frontend: `http://localhost:3000`
- backend: `http://localhost:4000`
- demo room: `http://localhost:3000/room/demo-room`

## Переменные окружения

```env
NEXT_PUBLIC_SERVER_URL=http://localhost:4000
NEXT_PUBLIC_WS_URL=ws://localhost:4000
DATABASE_URL=postgresql://collabcode:collabcode@localhost:5432/collabcode
PORT=4000
PYTHON_IMAGE=collabcode-python-runner:latest
EXECUTION_TIMEOUT_MS=8000
```

## Demo сценарий

1. Откройте `http://localhost:3000/room/demo-room` в двух вкладках.
2. Покажите, что текст синхронизируется между вкладками в реальном времени.
3. Обратите внимание на удаленные курсоры и список участников.
4. Добавьте рискованный код, например `eval("2+2")`, и покажите AI review справа.
5. Нажмите `Run Python` и продемонстрируйте общий терминал для обеих вкладок.
6. Закройте одну вкладку и покажите offline-статус участника в dashboard.

## Demo данные

### Sample room

- `roomId`: `demo-room`
- файл: `main.py`
- язык: `python`

### Sample code

Файл загружается из [`apps/server/src/services/demo-data.ts`](/C:/Users/kiree/OneDrive/Документы/hakanons/01.04/apps/server/src/services/demo-data.ts).

### Sample AI outputs

Примеры находятся в [`demo/sample-ai-suggestions.json`](/C:/Users/kiree/OneDrive/Документы/hakanons/01.04/demo/sample-ai-suggestions.json).

## Технические решения для MVP

- AI reviewer сделан mock-first, чтобы демо не зависело от внешнего LLM
- Execution sandbox ограничен только Python, что упрощает безопасный запуск
- Room state живет в памяти сервера, чтобы уменьшить количество точек отказа
- PostgreSQL оставлен для room metadata и seed-скриптов, чтобы сохранить архитектурную готовность к расширению

## Команды

```bash
npm run dev
npm run build
npm run typecheck
npm run db:init
npm run seed
```

## Что можно улучшить после хакатона

- Персистентное хранение документов в PostgreSQL или object storage
- Настоящий LLM provider вместо mock reviewer
- Несколько файлов в комнате
- Аутентификация и права доступа
- Очередь задач для sandbox execution
- Полноценная replay-история изменений
