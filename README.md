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

## Database migrations

- `20261116000000_add_antimut_enabled_to_business_chat_settings.sql` — per-chat antimut state.
- `20261116010000_flamexbot_admin_badges_daily_tasks_achievements.sql` — moderation fields, role badges, admin RPCs, rotating daily tasks and achievement catalogue.
- `20261116011000_fix_admin_premium_upsert.sql` — safe Premium extension upsert.
- `20261116012000_guarantee_daily_task_rotation.sql` — guarantees a different daily challenge set.
- `20261116013000_publish_profiles_for_moderation.sql` — enables immediate ban updates in active sessions.
- `20261116014000_admin_directory_telegram_avatar.sql` — shows Telegram avatars in the admin directory.
- `20261116015000_daily_progress_and_auto_read_notifications.sql` — calculates daily task progress only from the signed-in user's Business chats and marks notifications read at insertion.
- `20261116016000_enforced_bans_and_admin_audit.sql` — enforces bans in Supabase Auth and user-scoped RLS policies, and adds an owner-only moderation audit log.
- `20261116035000_flamexbot_command_protection_addon_and_webhook_reliability.sql` — adds the five-day command-protection entitlement, private Stars payment ledger, and durable Telegram update receipts with retry-safe processing.

- `20261117121753_flamexbot_trigger_acl_and_fk_indexes.sql` — restricts direct execution of trigger-only SECURITY DEFINER functions and indexes Business-chat foreign keys.

These migrations have been applied to the connected Supabase project. The owner account has the protected Founder, Verified, Developer and Administrator badges.

## Telegram Business

1. В @BotFather включи Business Mode для FLAMEXBOT.
2. В Telegram открой **Настройки → Telegram Business → Чат-боты**.
3. Подключи FLAMEXBOT и выдай только те права, которые действительно нужны.
4. Открой Mini App и перейди в раздел «Переписки».

FLAMEXBOT работает только с диалогами и разрешениями, которые владелец Business-аккаунта предоставил Telegram-боту.

## Команды

Команды управления вводятся **прямо в нужной переписке Telegram Business**, а не в личном чате с ботом. Поддерживаются оба префикса: `.` и `/`. Отправитель команды — владелец подключённого Business-аккаунта. FLAMEXBOT автоматически определяет текущий диалог: указывать `@username` или ID собеседника не нужно.

| Команда | Действие |
|---|---|
| `/start` | Открыть бота и Mini App |
| `/help` | Получить подсказку в личном чате с ботом |
| `/ping` | Проверить, что бот отвечает в личном чате или Business-диалоге |
| `/status` | Проверить состояние Telegram Business и выданные разрешения |
| `/commands` | Получить справку по командам в личном чате с ботом |
| `/premium` | Создать счёт на Premium в Telegram Stars на 30 дней; продление вручную |
| `/pro` | Создать счёт на FLAMEX PRO в Telegram Stars на 30 дней; при переходе с Premium сохраняется остаток срока |
| `.ping` / `/ping` | Проверить обработчик Business-команд в текущем диалоге |
| `.help` | Показать список Business-команд в текущем диалоге |
| `.mute` | Включить удаление новых входящих сообщений в текущем диалоге |
| `.unmute` | Отключить удаление новых сообщений |
| `.antimute on` / `.antimut on` | Разрешить одну ручную попытку отправки через Business |
| `.antimute off` / `.antimut off` | Выключить режим антимута |
| `.antimute текст` / `.antimut текст` | Выполнить одну попытку отправки указанного текста |
| `.spamallow` / `.spamstop` | Дать или отозвать согласие на тестовые повторные сообщения |
| `.spam 2-5 текст` | Отправить от двух до пяти согласованных тестовых копий; требуется FLAMEX PRO |
| `.afk причина` / `.unafk` | Включить или выключить автоответ |
| `.autoread on/off` | Настроить автоматическую отметку прочтения |
| `.autotyping on/off` | Настроить статус «печатает…» |
| `.autovoice on/off` | Настроить статус записи голосового |
| `.mutestick on/off` | Включить или выключить фильтр стикеров |
| `.timeprofile +3` | Установить часовой пояс |
| `.antimat` / `.unantimat` | Включить или выключить фильтр ненормативной лексики |
| `.time` / `.untime` | Показать или скрыть время профиля |
| `.bold текст` / `.dumb текст` | Изменить оформление текста |
| `.link текст` | Создать ссылку на текущий диалог |

Для включения Premium-команд требуется активная подписка. Команды отключения и размут доступны и после окончания подписки, чтобы можно было безопасно отменить ранее включённые режимы.

### Дополнение «Защита от команд»

- Покупка в разделе «Тарифы → Дополнение» за **15 Telegram Stars на 5 дней**.
- Пока защита активна, другие пользователи не могут применять к аккаунту команды FLAMEXBOT в Business-диалогах.
- Основатель FLAMEXBOT может применять команды к любым аккаунтам независимо от их защиты.
- Повторная покупка продлевает действующий срок ещё на пять дней.
- Обычная переписка не блокируется: защита отключает команды и их автоматические действия в защищённом диалоге.
- Проверка защиты выполняется на стороне сервера: в Telegram webhook и в Edge Function для команд, переключателей и ручных отправок Mini App. Скрытие кнопок не используется как механизм безопасности.
- Оплата подтверждается Telegram через `pre_checkout_query` и `successful_payment`; счёт имеет ограниченный срок действия, а повторная обработка платежа защищена уникальным идентификатором Telegram.

## Защита владельца

Telegram ID владельца FLAMEXBOT защищён на серверной стороне. Ни команды, ни inline-кнопки, ни автоматические действия не применяются к его диалогу. Защита действует независимо от состояния переключателей в Mini App.



## Mini App 2.0

- Основная навигация находится в меню аватара справа сверху; нижней панели и отдельного центра уведомлений больше нет.
- Страница работает как SPA: переключение разделов не перемонтирует всё приложение, а обновление токена авторизации не запускает повторный рендер.
- При выходе или смене аккаунта закрываются старые Realtime-каналы, таймеры и кэш переписок.
- История чата загружается порциями по 100 последних сообщений; повторные события Realtime объединяются, а ссылки на медиа создаются пакетно.
- Загрузка второстепенных достижений и каналов вынесена из критического пути первого рендера.
- Уведомления автоматически отмечаются прочитанными при входе и сразу после поступления.
- Для загрузки разделов используется отдельный экран ожидания с анимированным знаком FLAMEXBOT.
- Профиль поддерживает ролевые значки: Verified (синяя галочка), Founder, Developer, Administrator, Moderator, Designer, Creator, Supporter, Beta Tester, Community Manager и Partner.

## Ежедневные задания и достижения

- Каждый день сервер выбирает три задания из пула из десяти вариантов.
- Набор меняется по UTC-дате; награда проверяется серверной функцией, повторное получение за тот же день невозможно.
- Достижения отделены от ежедневных заданий: серия, сообщения, друзья, Business-диалоги, заполненный профиль, Premium и активность по времени.
- XP за задания и достижения формируют уровень пользователя.

## Административная панель

Админ-панель доступна только владельцу через серверную проверку `is_flamexbot_admin()`. Значок Administrator сам по себе не выдаёт административные права.

В разделе «Все пользователи» доступны:
- сортировка от новых регистраций к старым;
- поиск по имени, никнейму и Telegram ID;
- фильтры Verified / без галочки, Premium / Free и активные / заблокированные;
- выдача и снятие синей галочки;
- блокировка с причиной и разблокировка; бан также блокирует вход через Supabase Auth и закрывает доступ к пользовательским данным через RLS;
- журнал последних административных действий: выдача галочек, Premium, значков ролей и блокировки;
- выдача Premium на срок от 1 до 3650 дней или бессрочно, продление и снятие;
- выдача и снятие ролевых значков.

Защита на сервере не позволяет заблокировать владельца или снять его синюю галочку и значок Founder. Настройка Telegram webhook дополнительно разрешена только аккаунту Основателя. Бан блокирует Supabase Auth, проверяется при Telegram-входе и при загрузке профиля; пользовательские RLS-политики дополнительно закрывают доступ к данным. Ролевые значки не меняют реальные права доступа.

## Ограничения Telegram

- Мут удаляет только новые входящие сообщения и требует права Telegram Business `can_delete_all_messages`. Ранее сохранённая история не удаляется.
- Антимут **не снимает блокировку и не обходит настройки приватности**. Он выполняет только одну ручную попытку отправки через подключённый Business-аккаунт, если Telegram разрешает ответ и выдано право `can_reply`.
- Если Telegram отклоняет отправку, FLAMEXBOT показывает причину и не запускает автоматические повторные попытки.
- Типы файлов определяются по MIME и расширению; GIF отправляются как анимация, неизвестные форматы — как документы без автоматического определения MIME Telegram.
- Премиум-эмодзи проверяются через Telegram Bot API. Если конкретный эмодзи или право на его отправку недоступны, используется обычный Unicode-эмодзи.
- Некоторые действия недоступны без соответствующих разрешений Telegram Business. FLAMEXBOT не может выдать эти разрешения вместо владельца аккаунта.

## Публикация

Cloudflare Pages использует:

- Build command: `npm run build`
- Build output directory: `dist`
- Production branch: `main`

Supabase Edge Functions (исходники новых и обновлённых endpoint хранятся в `supabase/functions/`):

- `telegram-auth`
- `flamexbot-bot`
- `business-chat-send`
- `create-premium-invoice`
- `create-command-protection-invoice`
- `setup-flamexbot-webhook` — вызов настройки webhook разрешён только Основателю; Telegram update_id сохраняются в журнале обработки, чтобы повторные webhook-доставки не запускали завершённые команды повторно.

Webhook обрабатывает обновления с журналом `processing/completed/failed`: дубликаты не выполняются повторно, а временные ошибки возвращают Telegram возможность повторной доставки.

## Безопасность

Во фронтенде разрешено хранить только Supabase publishable key. Никогда не добавляй в репозиторий Telegram Bot Token, Supabase service-role key или другие секреты. Серверные секреты должны оставаться в настройках Supabase Edge Functions.
