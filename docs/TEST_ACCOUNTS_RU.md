# Тестовые аккаунты и проверка Telegram-бота

## 1) Тестовые аккаунты

Используйте эти учетные данные для ручного тестирования ролей в комнате:

| Роль | Email | Пароль |
|---|---|---|
| Владелец | owner@collabcode.local | Owner12345! |
| Редактор | editor@collabcode.local | Editor12345! |
| Наблюдатель (viewer) | viewer@collabcode.local | Viewer12345! |

Важно: если аккаунты еще не созданы в БД, зарегистрируйте их через страницу `/auth` (режим регистрации) или через API ниже.

### Быстрое создание через API (PowerShell)

```powershell
$users = @(
  @{ email = "owner@collabcode.local";  password = "Owner12345!";  name = "Owner Demo"  },
  @{ email = "editor@collabcode.local"; password = "Editor12345!"; name = "Editor Demo" },
  @{ email = "viewer@collabcode.local"; password = "Viewer12345!"; name = "Viewer Demo" }
)

foreach ($u in $users) {
  try {
    Invoke-RestMethod -Method Post `
      -Uri "http://localhost:4000/api/auth/register" `
      -ContentType "application/json" `
      -Body ($u | ConvertTo-Json)
    Write-Host "Создан: $($u.email)"
  } catch {
    Write-Host "Пропущен (возможно уже есть): $($u.email)"
  }
}
```

## 2) Как протестировать Telegram-бота

### Шаг 1. Подготовка в Telegram

1. Создайте бота через `@BotFather` и получите `TELEGRAM_BOT_TOKEN`.
2. Добавьте бота в нужный чат (личный или групповой).
3. Узнайте `TELEGRAM_CHAT_ID`:
   - Личный чат: напишите боту любое сообщение и получите `chat_id` через `getUpdates`.
   - Группа: добавьте бота в группу и также получите `chat_id` через `getUpdates` (обычно отрицательное число).

Пример `getUpdates`:

```text
https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getUpdates
```

### Шаг 2. Настройка `.env`

```dotenv
TELEGRAM_BOT_TOKEN=ваш_токен_бота
TELEGRAM_CHAT_ID=ваш_chat_id
```

После изменения `.env` перезапустите сервер:

```powershell
docker compose up -d --build server
```

### Шаг 3. Отправить тестовое уведомление

Сначала логинимся, затем вызываем endpoint теста:

```powershell
$login = Invoke-RestMethod -Method Post `
  -Uri "http://localhost:4000/api/auth/login" `
  -ContentType "application/json" `
  -Body (@{ email = "owner@collabcode.local"; password = "Owner12345!" } | ConvertTo-Json)

$token = $login.token

Invoke-RestMethod -Method Post `
  -Uri "http://localhost:4000/api/platform/integrations/test" `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json" `
  -Body "{}"
```

Если всё настроено верно, сообщение придет в Telegram-чат.

## 3) Где это в коде

- Отправка уведомлений: `apps/server/src/services/notification-service.ts`
- Тестовый endpoint интеграций: `POST /api/platform/integrations/test` в `apps/server/src/index.ts`
- События runtime (старт/стоп), которые тоже отправляют уведомления: `apps/server/src/index.ts`
