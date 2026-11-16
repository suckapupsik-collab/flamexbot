# FLAMEXBOT

FLAMEXBOT — Telegram Mini App для общения, общих огоньков и управления Telegram Business-переписками.

## Технологии

- Vite + JavaScript
- Supabase Auth, PostgreSQL, Row Level Security и Realtime
- Telegram Bot API и Telegram Business
- Cloudflare Pages

## Запуск локально

1. Установи Node.js 20.19+ или 22.12+.
2. Скопируй `.env.example` в `.env.local`.
3. Укажи `VITE_SUPABASE_URL` и `VITE_SUPABASE_PUBLISHABLE_KEY`.
4. Выполни `npm install`, затем `npm run dev`.
5. Для проверки production-сборки выполни `npm run build`.

## Database migration

The antimut feature uses the per-chat `antimut_enabled` flag. The migration is stored in `supabase/migrations/20261116000000_add_antimut_enabled_to_business_chat_settings.sql` and has already been applied to the connected Supabase project.

## Telegram Business

1. В @BotFather включи Business Mode для FLAMEXBOT.
2. В Telegram открой **Настройки → Telegram Business → Чат-боты**.
3. Подключи FLAMEXBOT и выдай только те права, которые действительно нужны.
4. Открой Mini App и перейди в раздел «Переписки».

FLAMEXBOT работает только с диалогами и разрешениями, которые владелец Business-аккаунта предоставил Telegram-боту.

## Команды

Команды вводятся **не в личном чате с ботом**, а прямо в переписке с нужным человеком. Отправитель команды — владелец подключённого Business-аккаунта. FLAMEXBOT автоматически определяет текущий диалог: указывать `@username` или ID собеседника не нужно.

| Команда | Действие |
|---|---|
| `.help` | Показать список команд |
| `.mute` | Включить удаление новых входящих сообщений в текущем диалоге |
| `.unmute` | Отключить удаление новых сообщений |
| `.antimute on` / `.antimut on` | Разрешить одну ручную попытку отправки через Business |
| `.antimute off` / `.antimut off` | Выключить режим антимута |
| `.antimute текст` / `.antimut текст` | Выполнить одну попытку отправки указанного текста |
| `.spam 2-5 текст` | Отправить от двух до пяти копий сообщения |
| `.afk причина` / `.unafk` | Включить или выключить автоответ |
| `.autoread on/off` | Настроить автоматическую отметку прочтения |
| `.autotyping on/off` | Настроить статус «печатает…» |
| `.autovoice on/off` | Настроить статус записи голосового |
| `.mutestick on/off` | Включить или выключить фильтр стикеров |
| `.timeprofile +3` | Установить часовой пояс |
| `.time` / `.untime` | Показать или скрыть время профиля |
| `.bold текст` / `.dumb текст` | Изменить оформление текста |
| `.link текст` | Создать ссылку на текущий диалог |

Для включения Premium-команд требуется активная подписка. Команды отключения и размут доступны и после окончания подписки, чтобы можно было безопасно отменить ранее включённые режимы.

## Защита владельца

Telegram ID владельца FLAMEXBOT защищён на серверной стороне. Ни команды, ни inline-кнопки, ни автоматические действия не применяются к его диалогу. Защита действует независимо от состояния переключателей в Mini App.

## Ограничения Telegram

- Мут удаляет только новые входящие сообщения и требует права Telegram Business `can_delete_all_messages`. Ранее сохранённая история не удаляется.
- Антимут **не снимает блокировку и не обходит настройки приватности**. Он выполняет только одну ручную попытку отправки через подключённый Business-аккаунт, если Telegram разрешает ответ и выдано право `can_reply`.
- Если Telegram отклоняет отправку, FLAMEXBOT показывает причину и не запускает автоматические повторные попытки.
- Премиум-эмодзи проверяются через Telegram Bot API. Если конкретный эмодзи или право на его отправку недоступны, используется обычный Unicode-эмодзи.
- Некоторые действия недоступны без соответствующих разрешений Telegram Business. FLAMEXBOT не может выдать эти разрешения вместо владельца аккаунта.

## Публикация

Cloudflare Pages использует:

- Build command: `npm run build`
- Build output directory: `dist`
- Production branch: `main`

Supabase Edge Functions:

- `telegram-auth`
- `flamexbot-bot`
- `business-chat-send`
- `create-premium-invoice`
- `setup-flamexbot-webhook`

## Безопасность

Во фронтенде разрешено хранить только Supabase publishable key. Никогда не добавляй в репозиторий Telegram Bot Token, Supabase service-role key или другие секреты. Серверные секреты должны оставаться в настройках Supabase Edge Functions.
