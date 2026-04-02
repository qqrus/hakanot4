# Тестовые аккаунты для демо

## Как создать
1. Убедитесь, что PostgreSQL и server запущены.
2. Выполните:

```bash
npm run seed:accounts --workspace @collabcode/server
```

Скрипт идемпотентный: уже существующие аккаунты не дублируются.

## Набор аккаунтов
| Роль | Email | Пароль |
|---|---|---|
| Владелец | `owner.demo@collabcode.local` | `DemoOwner123!` |
| Редактор | `editor.demo@collabcode.local` | `DemoEditor123!` |
| Наблюдатель | `viewer.demo@collabcode.local` | `DemoViewer123!` |
| Член жюри | `jury.demo@collabcode.local` | `DemoJury123!` |

## Рекомендация
- Используйте отдельную демо-комнату на показе.
- После демо поменяйте пароли или удалите эти аккаунты.
