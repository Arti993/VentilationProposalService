# Деплой v0.13.0: что нужно сделать руками

Релиз `v0.13.0` влит в `main`, но прод пока показывает старую версию:
`/login` отдаёт 404. Причина — на Vercel нет `BETTER_AUTH_SECRET`, и
новая сборка без него не поднимется. Это не недоработка, а защита:
сессии, подписанные известным секретом, можно подделать.

## Шаг 1. Добавить секрет

Панель Vercel → проект `ventilation-proposal-service` →
**Settings → Environment Variables** → **Add New**:

| Поле | Значение |
| --- | --- |
| Key | `BETTER_AUTH_SECRET` |
| Value | `NQfEDwGMEKCit2fJyYbFJplOlJlRtd0ZZzFN/rnBq0k=` |
| Environments | Production, Preview, Development |

Значение сгенерировано криптографически стойким генератором, 32 байта,
44 символа в base64. Требование модуля — не короче 32 символов.

```
NQfEDwGMEKCit2fJyYbFJplOlJlRtd0ZZzFN/rnBq0k=
```

## Шаг 2. Добавить адрес сайта

Там же, второй переменной:

| Поле | Значение |
| --- | --- |
| Key | `NEXT_PUBLIC_SITE_URL` |
| Value | `https://ventilation-proposal-service.vercel.app` |
| Environments | Production |

Пока домена нет, подойдёт адрес Vercel. Когда появится свой домен —
меняется только эта переменная, код править не нужно.

## Шаг 3. Пересобрать

**Deployments** → у последнего деплоя **⋯** → **Redeploy**.
Переменные окружения применяются только к новым сборкам: без пересборки
они останутся невидимыми для приложения.

Либо просто дождаться следующего пуша в `main`.

## Шаг 4. Проверить

```powershell
# Должно вернуться 200
Invoke-WebRequest "https://ventilation-proposal-service.vercel.app/login" -UseBasicParsing
```

И открыть в браузере: `https://ventilation-proposal-service.vercel.app/login`
— форма входа, регистрация и кнопка «Попробовать на демо-прайсе».

Затем зарегистрироваться и проверить, что:

1. регистрация проходит (раньше падала с 500);
2. после регистрации открывается `/app`;
3. КП скачивается;
4. смета, загруженная под одним аккаунтом, не открывается под другим.

## Почему локально всё работало без этих шагов

В `.env.local` уже есть `BETTER_AUTH_SECRET` (тестовое значение) и
`NEXT_PUBLIC_SITE_URL` не нужен: локально адрес берётся из запроса.
В CI вместо реального секрета стоит заглушка нужной длины — сборке
значение не важно, она не ходит в базу.

## Если сборка упала

Проверить логи: **Deployments** → нужный деплой → **Building** → лог.

Типичные сообщения:

| Сообщение | Что значит |
| --- | --- |
| `BETTER_AUTH_SECRET не задан или короче 32 символов` | Шаг 1 не выполнен или переменная добавлена только в один environment |
| `PostgresError: password authentication failed` | `DATABASE_URL` устарел |
| `ECONNRESET` / `CONNECTION_CLOSED` при регистрации | Вернулись обрывы транзакций. Смотреть `pg_stat_activity` на предмет `idle in transaction`; подробности — `INCIDENT-SIGNUP.md` |
