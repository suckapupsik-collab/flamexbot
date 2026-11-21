export function explainTelegramSendError(description) {
  const raw = String(description ?? "ошибка Telegram API");
  const lower = raw.toLowerCase();
  if (/user not found/.test(lower)) {
    return "Telegram не нашёл пользователя для этого Business-чата. Обнови список диалогов; если ошибка повторяется, переподключи Telegram Business.";
  }
  if (/blocked by the user|bot was blocked|user is deactivated|chat not found|peer_id_invalid/.test(lower)) {
    return "Telegram отклонил отправку: чат недоступен или получатель ограничил сообщения. FLAMEXBOT не может обходить блокировки.";
  }
  if (/bot can\\x27t initiate conversation|bot cannot initiate|bot can\\x27t send messages to bots/.test(lower)) {
    return "Чтобы отправить сообщение через FLAMEXBOT, собеседник должен сначала открыть бота и нажать Start. Антимут не обходит блокировки Telegram.";
  }
  if (/business_connection_invalid|business connection.*(invalid|not found|disabled)/.test(lower)) {
    return "Telegram Business-подключение недействительно или отключено.";
  }
  if (/not enough rights|can't write|can_reply|chat_write_forbidden|have no rights/.test(lower)) {
    return "Telegram не разрешил отправку: у Business-подключения нет нужного права или чат недоступен для ответа.";
  }
  if (/too many requests|retry after/.test(lower)) {
    return "Telegram временно ограничил отправку. Подожди и попробуй позже вручную.";
  }
  return `Telegram отклонил отправку: ${raw.slice(0, 220)}`;
}
export function hasBusinessRight(rights, permission) {
  return rights?.[permission] === true;
}
export function afkEnabledForCommand(commandName) {
  if (commandName === "afk") return true;
  if (commandName === "unafk") return false;
  return null;
}
