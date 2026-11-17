  const price = plan === "pro" ? PRO_PRICE_STARS : PREMIUM_PRICE_STARS;
  const name = plan === "pro" ? "FLAMEX PRO" : "FLAMEXBOT Premium";
  const description = plan === "pro"
    ? "FLAMEX PRO на 30 дней: Premium-функции, 2 еженедельные прокрутки колеса, +10% к весам редких наград и экспорт переписки."
    : "FLAMEXBOT Premium на 30 дней: Premium-инструменты и 1 бесплатная прокрутка колеса каждую неделю.";
  const payload = `flamexbot_${plan}:${profile.id}:${crypto.randomUUID()}`;
  await telegram("sendInvoice", {
    chat_id: chatId, title: name, description, payload, currency: "XTR",
    prices: [{ label: (plan === "pro" ? "PRO" : "Premium") + " · 30 дней", amount: price }],
  });
}
async function handlePreCheckout(query: any) {
  let ok = false;
  let rejectionMessage = "Счёт недействителен или устарел. Создай новый счёт в FLAMEXBOT.";
  try {
    if (admin && query.currency === "XTR") {
      const payload = String(query.invoice_payload ?? "");
      const premiumUserId = parsePremiumPayload(payload);
      const proUserId = parseProPayload(payload);
      const tierUserId = premiumUserId || proUserId;
      const expectedTierAmount = proUserId ? PRO_PRICE_STARS : PREMIUM_PRICE_STARS;
      if (tierUserId && query.total_amount === expectedTierAmount) {
        const { data: profile, error } = await admin.from("profiles")
          .select("id,telegram_id,is_banned").eq("id", tierUserId).maybeSingle();
        if (error) throw error;
        const { data: current, error: currentError } = await admin.from("user_subscriptions")
          .select("plan,expires_at").eq("user_id", tierUserId).maybeSingle();
        if (currentError) throw currentError;
        const currentActive = Boolean(current && (!current.expires_at || new Date(current.expires_at).getTime() > Date.now()));
        const isLifetime = Boolean(current && !current.expires_at && ["premium","pro"].includes(current.plan));
        const isForbiddenDowngrade = Boolean(premiumUserId && currentActive && current.plan === "pro");
        if (isLifetime) rejectionMessage = "У тебя уже бессрочная подписка. Повторная покупка не требуется.";
        else if (isForbiddenDowngrade) rejectionMessage = "У тебя активен PRO. Покупка Premium не нужна.";
        ok = Boolean(profile && !profile.is_banned && profile.telegram_id === String(query.from?.id)
          && !isForbiddenDowngrade && !isLifetime);
      } else if (parseCommandProtectionPayload(payload) && query.total_amount === 15) {
        const { data: order, error: orderError } = await admin.from("flamexbot_addon_star_payments")
          .select("user_id,telegram_user_id,addon_code,currency,total_amount,period_days,status,valid_until")
          .eq("invoice_payload", payload).maybeSingle();
        if (orderError) throw orderError;
        if (order && order.addon_code === "command_protection" && order.currency === "XTR"
            && order.total_amount === 15 && order.period_days === 5 && order.status === "pending"
            && new Date(order.valid_until).getTime() > Date.now()
            && order.telegram_user_id === String(query.from?.id)) {
          const { data: profile, error: profileError } = await admin.from("profiles")
            .select("id,telegram_id,is_banned").eq("id", order.user_id).maybeSingle();
          if (profileError) throw profileError;
          ok = Boolean(profile && !profile.is_banned && profile.telegram_id === String(query.from?.id));
        }
      } else if (parseWheelPayload(payload) && query.total_amount === 5) {
        const { data: order, error: orderError } = await admin.from("flamexbot_wheel_orders")
          .select("user_id,telegram_user_id,status,price_stars").eq("invoice_payload",payload).maybeSingle();
        if (orderError) throw orderError;
        if (order && order.status === "pending" && order.price_stars === 5 && order.telegram_user_id === String(query.from?.id)) {
          const { data: profile, error: profileError } = await admin.from("profiles")
            .select("telegram_id,is_banned").eq("id",order.user_id).maybeSingle();
          if (profileError) throw profileError;
          ok = Boolean(profile && !profile.is_banned && profile.telegram_id === String(query.from?.id));
        }
      }
    }
  } catch (error) { console.error("pre-checkout validation:", error?.message ?? error); }
  await telegram("answerPreCheckoutQuery", { pre_checkout_query_id: query.id, ok, ...(!ok ? { error_message: rejectionMessage } : {}) });
}
async function refundTelegramStarsPayment(telegramUserId: number, chargeId: string) {
  try {
    await telegram("refundStarPayment", { user_id: telegramUserId, telegram_payment_charge_id: chargeId });
  } catch (error) {
    const message = String(error?.message ?? error ?? "");
    if (!/ALREADY_REFUNDED|already refunded/i.test(message)) throw error;
  }
}

async function refundAndRecordStarsPayment(args: {
  userId: string;
  telegramUserId: string;
  invoicePayload: string;
  paymentKind: "premium" | "pro" | "wheel" | "command_protection";
  currency: string;
  totalAmount: number;
  chargeId: string;
  providerChargeId?: string | null;
  reason: string;
}) {
  if (!admin) throw new Error("Database is unavailable while recording Stars refund");
  const { error: prepareError } = await admin.rpc("prepare_flamexbot_star_refund", {
    p_telegram_payment_charge_id: args.chargeId,
    p_user_id: args.userId,
    p_telegram_user_id: args.telegramUserId,
    p_invoice_payload: args.invoicePayload,
    p_payment_kind: args.paymentKind,
    p_currency: args.currency,
    p_total_amount: args.totalAmount,
    p_provider_payment_charge_id: args.providerChargeId ?? null,
    p_reason: args.reason,
  });
  if (prepareError) throw prepareError;

  // Persist refund intent before contacting Telegram. A retry can safely resume it.
  await refundTelegramStarsPayment(Number(args.telegramUserId), args.chargeId);
  const { data: completed, error: completeError } = await admin.rpc("complete_flamexbot_star_refund", {
    p_telegram_payment_charge_id: args.chargeId,
  });
  if (completeError || completed !== true) {
    throw completeError ?? new Error("Could not finalize Stars refund record");
  }
}

async function sendPaymentNotificationOnce(
  userId: string,
  notificationType: string,
  dataFilter: Record<string, unknown>,
  chatId: number | string,
  body: string,
  replyMarkup?: Record<string, unknown>,
) {
  if (!admin) return;
  const { data: notice, error: noticeError } = await admin.from("notifications")
    .select("id").eq("user_id", userId).eq("type", notificationType)
    .contains("data", dataFilter)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (noticeError) {
    console.warn("Could not locate payment notification; queued delivery will handle it:", noticeError.message);
    return;
  }
  if (!notice?.id) {
    // The payment RPC may not have produced a notification; there is no queue row to race with.
    try { await sendRichTelegramMessage(chatId, body, "HTML", replyMarkup); }
    catch (error) { console.warn("Payment confirmation send failed:", (error as any)?.message ?? error); }
    return;
  }

  const claimToken = crypto.randomUUID();
  const { data: claimed, error: claimError } = await admin.rpc("claim_flamexbot_telegram_notification_by_id", {
    p_notification_id: notice.id,
    p_user_id: userId,
    p_claim_token: claimToken,
  });
  const ownsClaim = Array.isArray(claimed)
    && claimed.some((item: any) => item?.notification_id === notice.id);
  if (claimError || !ownsClaim) {
    if (claimError) console.warn("Could not claim payment notification:", claimError.message);
    return;
  }

  try {
    await sendRichTelegramMessage(chatId, body, "HTML", replyMarkup);
  } catch (error) {
    const reason = String((error as any)?.message ?? error);
    const outcomeUnknown = error instanceof TypeError || /timeout|timed out|network|connection reset|aborted/i.test(reason);
    if (!outcomeUnknown) {
      const { error: releaseError } = await admin.rpc("release_flamexbot_telegram_notification_claims", {
        p_claim_token: claimToken,
      });
      if (releaseError) console.warn("Could not release failed payment notification claim:", releaseError.message);
    }
    console.warn("Payment confirmation send failed:", reason);
    return;
  }

  const { data: marked, error: markError } = await admin.rpc("mark_flamexbot_telegram_notification_delivered", {
    p_notification_id: notice.id,
    p_claim_token: claimToken,
  });
  if (markError || marked !== true) {
    console.warn("Could not confirm payment notification delivery:", markError?.message ?? "claim token no longer owns notification");
  }
}

async function handleSuccessfulPayment(message: any) {
  if (!admin || !message?.from?.id || !message?.successful_payment) return;
  const payment = message.successful_payment;
  const invoicePayload = String(payment.invoice_payload ?? "");
  const chargeId = String(payment.telegram_payment_charge_id ?? "");
  if (chargeId) {
    const { data: refundRows, error: refundLookupError } = await admin.rpc("get_flamexbot_star_refund_status", {
      p_telegram_payment_charge_id: chargeId,
    });
    if (refundLookupError) throw refundLookupError;
    const recordedRefund = Array.isArray(refundRows) ? refundRows[0] : null;
    if (recordedRefund) {
      if (recordedRefund.invoice_payload !== invoicePayload
          || recordedRefund.telegram_user_id !== String(message.from.id)) {
        throw new Error("Refunded Telegram charge does not match the repeated payment update");
      }
      await refundTelegramStarsPayment(Number(message.from.id), chargeId);
      const { error: completeError } = await admin.rpc("complete_flamexbot_star_refund", {
        p_telegram_payment_charge_id: chargeId,
      });
      if (completeError) throw completeError;
      console.log("Resumed previously recorded Stars refund", chargeId);
      return;
    }
  }
  const wheelUserId = parseWheelPayload(invoicePayload);
  if (wheelUserId) {
    if (payment.currency !== "XTR" || payment.total_amount !== 5 || !payment.telegram_payment_charge_id) throw new Error("Wheel payment mismatch");
    const { data: order, error: orderError } = await admin.from("flamexbot_wheel_orders")
      .select("id,user_id,telegram_user_id,status").eq("invoice_payload",invoicePayload).maybeSingle();
    if (orderError) throw orderError;
    if (!order || order.user_id !== wheelUserId || order.telegram_user_id !== String(message.from.id)) throw new Error("Wheel order does not match payer");
    if (order.status === "paid") return;
    if (order.status === "refunded") {
      await refundAndRecordStarsPayment({
        userId: wheelUserId,
        telegramUserId: String(message.from.id),
        invoicePayload,
        paymentKind: "wheel",
        currency: payment.currency,
        totalAmount: payment.total_amount,
        chargeId: payment.telegram_payment_charge_id,
        providerChargeId: payment.provider_payment_charge_id ?? null,
        reason: "wheel_order_already_refunded",
      });
      return;
    }
    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("id,telegram_id,is_banned").eq("id",wheelUserId).maybeSingle();
    if (profileError) throw profileError;
    if (!profile || profile.telegram_id !== String(message.from.id)) throw new Error("Wheel payer does not match profile");
    if (profile.is_banned) {
      const { error: refundOrderError } = await admin.from("flamexbot_wheel_orders")
        .update({
          status: "refunded",
          telegram_payment_charge_id: payment.telegram_payment_charge_id,
          provider_payment_charge_id: payment.provider_payment_charge_id ?? null,
          paid_at: new Date().toISOString(),
        }).eq("id", order.id).eq("status", "pending");
      if (refundOrderError) throw refundOrderError;
      await refundAndRecordStarsPayment({
        userId: wheelUserId,
        telegramUserId: String(message.from.id),
        invoicePayload,
        paymentKind: "wheel",
        currency: payment.currency,
        totalAmount: payment.total_amount,
        chargeId: payment.telegram_payment_charge_id,
        providerChargeId: payment.provider_payment_charge_id ?? null,
        reason: "account_banned",
      });
      try { await sendRichTelegramMessage(message.chat.id,"Оплата возвращена: аккаунт заблокирован.","HTML"); }
      catch (notifyError) { console.warn("Could not send wheel refund notice:", (notifyError as any)?.message ?? notifyError); }
      return;
    }
    const {data:prize,error:prizeError}=await admin.rpc("apply_flamexbot_wheel_payment",{
      p_invoice_payload:invoicePayload,p_telegram_user_id:String(message.from.id),
      p_telegram_payment_charge_id:payment.telegram_payment_charge_id,
      p_provider_payment_charge_id:payment.provider_payment_charge_id??null,
      p_currency:payment.currency,p_total_amount:payment.total_amount
    });
    if(prizeError)throw prizeError;
    if(prize?.applied !== true) return;
    await sendPaymentNotificationOnce(
      wheelUserId,
      "wheel_prize",
      { wheel_order_id: order.id },
      message.chat.id,
      `${tgEmoji("sparkles")} <b>Колесо фортуны!</b>\nТвоя награда: <b>${String(prize?.prize_label??"Награда начислена")}</b>.\nОткрой FLAMEXBOT, чтобы посмотреть результат.`,
      {inline_keyboard:[[{text:"Открыть FLAMEXBOT",web_app:{url:APP_URL}}]]},
    );
    return;
  }
  const addonUserId = parseCommandProtectionPayload(invoicePayload);
  if (addonUserId) {
    if (payment.currency !== "XTR" || payment.total_amount !== 15 || !payment.telegram_payment_charge_id) {
      throw new Error("Successful Telegram Stars payment did not match a command protection invoice");
    }
    const { data: order, error: orderError } = await admin.from("flamexbot_addon_star_payments")
      .select("user_id,telegram_user_id,addon_code,total_amount,period_days,status")
      .eq("invoice_payload", invoicePayload).maybeSingle();
    if (orderError) throw orderError;
    if (!order || order.user_id !== addonUserId || order.addon_code !== "command_protection"
        || order.telegram_user_id !== String(message.from.id) || order.total_amount !== 15 || order.period_days !== 5) {
      throw new Error("Command protection payment does not match its invoice");
    }
    const { data: addonProfile, error: addonProfileError } = await admin.from("profiles")
      .select("id,telegram_id,is_banned,ban_reason").eq("id", addonUserId).maybeSingle();
    if (addonProfileError) throw addonProfileError;
    if (!addonProfile || addonProfile.telegram_id !== String(message.from.id)) {
      throw new Error("Telegram payment sender does not match the command protection account");
    }
    if (order.status === "paid") return;
    if (order.status === "refunded" || addonProfile.is_banned || order.status !== "pending") {
      if (order.status !== "refunded") {
        const { error: refundRecordError } = await admin.from("flamexbot_addon_star_payments")
          .update({
            status: "refunded",
            telegram_payment_charge_id: payment.telegram_payment_charge_id,
            provider_payment_charge_id: payment.provider_payment_charge_id ?? null,
            paid_at: new Date().toISOString(),
          }).eq("invoice_payload", invoicePayload).in("status", ["pending","failed"]);
        if (refundRecordError) throw refundRecordError;
      }
      await refundAndRecordStarsPayment({
        userId: addonUserId,
        telegramUserId: String(message.from.id),
        invoicePayload,
        paymentKind: "command_protection",
        currency: payment.currency,
        totalAmount: payment.total_amount,
        chargeId: payment.telegram_payment_charge_id,
        providerChargeId: payment.provider_payment_charge_id ?? null,
        reason: addonProfile.is_banned ? "account_banned" : "invoice_not_payable",
      });
      try { await sendRichTelegramMessage(message.chat.id, "⛔ Оплата дополнения возвращена: аккаунт заблокирован или счёт недействителен.", "HTML"); }
      catch (notifyError) { console.warn("Could not send add-on refund notice:", (notifyError as any)?.message ?? notifyError); }
      return;
    }
    const { data: applied, error: applyError } = await admin.rpc("apply_flamexbot_command_protection_payment", {
      p_invoice_payload: invoicePayload,
      p_telegram_user_id: String(message.from.id),
      p_telegram_payment_charge_id: payment.telegram_payment_charge_id,
      p_provider_payment_charge_id: payment.provider_payment_charge_id ?? null,
      p_currency: payment.currency,
      p_total_amount: payment.total_amount,
    });
    if (applyError) {
      const reason = String(applyError.message ?? applyError);
      if (/Command protection account is unavailable|Command protection invoice is not payable/i.test(reason)) {
        const { error: refundRecordError } = await admin.from("flamexbot_addon_star_payments")
          .update({
            status: "refunded",
            telegram_payment_charge_id: payment.telegram_payment_charge_id,
            provider_payment_charge_id: payment.provider_payment_charge_id ?? null,
            paid_at: new Date().toISOString(),
          }).eq("invoice_payload", invoicePayload).eq("status", "pending");
        if (refundRecordError) throw refundRecordError;
        await refundAndRecordStarsPayment({
          userId: addonUserId,
          telegramUserId: String(message.from.id),
          invoicePayload,
          paymentKind: "command_protection",
          currency: payment.currency,
          totalAmount: payment.total_amount,
          chargeId: payment.telegram_payment_charge_id,
          providerChargeId: payment.provider_payment_charge_id ?? null,
          reason: "account_or_invoice_unavailable",
        });
        try { await sendRichTelegramMessage(message.chat.id, "⛔ Счёт больше недействителен. Оплата возвращена.", "HTML"); }
        catch (notifyError) { console.warn("Could not send add-on refund notice:", (notifyError as any)?.message ?? notifyError); }
        return;
      }
      throw applyError;
    }
    if (applied === true) {
      await sendRichTelegramMessage(message.chat.id,
        `${tgEmoji("success")} <b>Защита от команд активирована!</b>\nНа ваш аккаунт нельзя применять команды FLAMEXBOT в течение 5 дней. Основатель проекта сохраняет доступ к командам на всех аккаунтах.`,
        "HTML");
    }
    return;
  }

  const premiumUserId = parsePremiumPayload(invoicePayload);
  const proUserId = parseProPayload(invoicePayload);
  const userId = premiumUserId || proUserId;
  const plan = proUserId ? "pro" : "premium";
  const expectedAmount = plan === "pro" ? PRO_PRICE_STARS : PREMIUM_PRICE_STARS;
  if (!userId || payment.currency !== "XTR" || payment.total_amount !== expectedAmount || !payment.telegram_payment_charge_id) {
    throw new Error("Successful Telegram Stars payment did not match a Premium/PRO invoice");
  }
  const { data: profile, error: profileError } = await admin.from("profiles")
    .select("id,telegram_id,is_banned,ban_reason").eq("id", userId).maybeSingle();
  if (profileError) throw profileError;
  if (!profile || profile.telegram_id !== String(message.from.id)) throw new Error("Telegram payment sender does not match the FLAMEXBOT account");
  if (profile.is_banned) {
    await refundAndRecordStarsPayment({
      userId,
      telegramUserId: String(message.from.id),
      invoicePayload,
      paymentKind: plan,
      currency: payment.currency,
      totalAmount: payment.total_amount,
      chargeId: payment.telegram_payment_charge_id,
      providerChargeId: payment.provider_payment_charge_id ?? null,
      reason: "account_banned",
    });
    try { await sendRichTelegramMessage(message.chat.id, "⛔ Аккаунт заблокирован. Оплата тарифа автоматически возвращена.", "HTML"); }
    catch (notifyError) { console.warn("Could not send subscription refund notice:", (notifyError as any)?.message ?? notifyError); }
    return;
  }
  const { data: applied, error: applyError } = await admin.rpc("apply_flamexbot_tier_payment", {
    p_user_id: userId,
    p_telegram_user_id: String(message.from.id),
    p_invoice_payload: payment.invoice_payload,
    p_telegram_payment_charge_id: payment.telegram_payment_charge_id,
    p_provider_payment_charge_id: payment.provider_payment_charge_id ?? null,
    p_currency: payment.currency,
    p_total_amount: payment.total_amount,
    p_period_days: PREMIUM_PERIOD_DAYS,
    p_plan: plan,
  });
  if (applyError) {
    const reason = String(applyError.message ?? applyError);
    if (/Active PRO cannot be downgraded by a Premium payment|Lifetime subscription is already active/i.test(reason)) {
      await refundAndRecordStarsPayment({
        userId,
        telegramUserId: String(message.from.id),
        invoicePayload,
        paymentKind: plan,
        currency: payment.currency,
        totalAmount: payment.total_amount,
        chargeId: payment.telegram_payment_charge_id,
        providerChargeId: payment.provider_payment_charge_id ?? null,
        reason: "subscription_state_changed_after_precheckout",
      });
      try { await sendRichTelegramMessage(message.chat.id, "⛔ Состояние тарифа изменилось до завершения оплаты. Деньги автоматически возвращены.", "HTML"); }
      catch (notifyError) { console.warn("Could not send subscription refund notice:", (notifyError as any)?.message ?? notifyError); }
      return;
    }
    throw applyError;
  }
  if (applied === true) {
    await sendPaymentNotificationOnce(
      userId,
      "subscription_activated",
      { payment_charge_id: payment.telegram_payment_charge_id },
      message.chat.id,
      plan === "pro"
        ? `${tgEmoji("diamond")} <b>Оплата прошла успешно!</b> FLAMEX PRO активирован на 30 дней. Тебе доступны 2 прокрутки каждую неделю и +10% к весам редких наград.`
        : `${tgEmoji("star")} <b>Оплата прошла успешно!</b> FLAMEXBOT Premium активирован на 30 дней. Тебе доступна 1 прокрутка каждую неделю.`,
    );
  }
}

const TELEGRAM_DELIVERABLE_NOTIFICATION_TYPES = [
  "weekly_wheel_spins",
  "subscription_activated",
  "wheel_prize",
  "referral_reward",
  "trial_activated",
  "account_banned",
  "account_unbanned",
  "verified",
  "unverified",
  "premium_granted",
  "premium_revoked",
  "pro_granted",
  "pro_revoked",
  "badge_granted",
  "badge_revoked",
  "business_connected",
  "business_disconnected",
];

async function deliverPendingTelegramNotifications(telegramUserId: number | string, privateChatId: number | string) {
  if (!admin) return;
  const { data: profile, error: profileError } = await admin.from("profiles")
    .select("id").eq("telegram_id", String(telegramUserId)).maybeSingle();
  if (profileError) {
    console.warn("Could not load notification recipient:", profileError.message);
    return;
  }
  if (!profile?.id) return;

  // Atomically reserve pending notifications so concurrent Telegram updates cannot send the same rows.
  const claimToken = crypto.randomUUID();
  const { data: pending, error: pendingError } = await admin.rpc("claim_flamexbot_telegram_notifications", {
    p_user_id: profile.id,
    p_claim_token: claimToken,
    p_limit: 8,
  });
  if (pendingError) {
    console.warn("Could not claim pending bot notifications:", pendingError.message);
    return;
  }

  for (const item of pending ?? []) {
    try {
      const title = String(item.title ?? "Уведомление FLAMEXBOT");
      const body = String(item.body ?? "");
      await sendRichTelegramMessage(privateChatId, "📬 " + title + (body ? "\n\n" + body : ""));
    } catch (error) {
      // A network timeout can happen after Telegram accepted the message, so keep the lease in that ambiguous case.
      const reason = String((error as any)?.message ?? error);
      const outcomeUnknown = error instanceof TypeError || /timeout|timed out|network|connection reset|aborted/i.test(reason);
      if (!outcomeUnknown) {
        const { error: releaseError } = await admin.rpc("release_flamexbot_telegram_notification_claims", {
          p_claim_token: claimToken,
        });
        if (releaseError) console.warn("Could not release failed notification claims:", releaseError.message);
      }
      console.warn("Bot notification delivery stopped:", reason);
      break;
    }

    const { data: marked, error: markError } = await admin.rpc("mark_flamexbot_telegram_notification_delivered", {
      p_notification_id: item.notification_id,
      p_claim_token: claimToken,
    });
    if (markError || marked !== true) {
      // Do not release the claim after a successful send: that could cause an immediate duplicate.
      console.warn("Could not confirm bot notification delivery:", markError?.message ?? "claim token no longer owns notification");
      break;
    }
  }
}

async function saveSupportInboxMessage(message: any) {
  if (!admin || message?.chat?.type !== "private" || !message?.chat?.id || !message?.message_id || !message?.from?.id || message.from.is_bot || String(message.from.id) === FOUNDER_TELEGRAM_ID) return;
  const media = messageMedia(message);
  const caption = messageContent(message);
  const content = media.type === "text" ? caption : JSON.stringify({
    _fx_media: 1, caption, file_id: media.fileId, file_name: message.document?.file_name ?? message.audio?.file_name ?? message.video?.file_name ?? null,
    mime_type: message.document?.mime_type ?? message.audio?.mime_type ?? message.video?.mime_type ?? null,
  });
  const telegramChatId = String(message.chat.id);
  const now = new Date((message.date ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();
  const { data: chat, error: chatError } = await admin.from("flamexbot_support_chats").upsert({
    telegram_chat_id: telegramChatId,
    telegram_user_id: String(message.from.id),
    username: message.from.username ?? null,
    first_name: message.from.first_name ?? null,
    last_name: message.from.last_name ?? null,
    last_message_preview: content.slice(0, 240),
    last_message_at: now,
    updated_at: new Date().toISOString(),
  }, { onConflict: "telegram_chat_id" }).select("id,unread_count").single();
  if (chatError) throw chatError;
  const { error: messageError } = await admin.from("flamexbot_support_messages").upsert({
    support_chat_id: chat.id,
    telegram_message_id: message.message_id,
    direction: "incoming",
    content,
    message_type: media.type,
    created_at: now,
  }, { onConflict: "support_chat_id,telegram_message_id", ignoreDuplicates: true });
  if (messageError) throw messageError;
  const { error: unreadError } = await admin.from("flamexbot_support_chats")
    .update({ unread_count: Number(chat.unread_count || 0) + 1, updated_at: new Date().toISOString() })
    .eq("id", chat.id);
  if (unreadError) throw unreadError;
}

async function processTelegramUpdate(update: any) {
  const startedAt=Date.now();
  try {
    console.log("telegram update received", JSON.stringify({
      update_id: update.update_id ?? null,
      update_types: Object.keys(update).filter((key) => key !== "update_id"),
      business_enabled: update.business_connection?.is_enabled ?? null,
      business_user_id: update.business_connection?.user?.id != null ? String(update.business_connection.user.id) : null,
    }));
    const directTelegramUserId =
      update.message?.from?.id ??
      update.callback_query?.from?.id ??
      update.pre_checkout_query?.from?.id ??
      update.business_connection?.user?.id;
    if (directTelegramUserId != null && String(directTelegramUserId) !== FOUNDER_TELEGRAM_ID && !update.message?.successful_payment) {
      const ban = await getTelegramBan(directTelegramUserId);
      if (ban) {
        if (update.message?.chat?.type === "private") {
          await sendRichTelegramMessage(update.message.chat.id, `⛔ FLAMEXBOT: доступ ограничен. ${ban.reason}`);
        }
        if (update.callback_query?.id) {
          await telegram("answerCallbackQuery", {
            callback_query_id: update.callback_query.id,
            text: "Аккаунт заблокирован администрацией FLAMEXBOT.",
            show_alert: true,
          });
        }
        console.warn("Blocked Telegram update from banned FLAMEXBOT user", String(directTelegramUserId));
        return new Response("OK", { status: 200 });
      }
    }
    if (update.message?.chat?.type === "private" && update.message.from?.id) {
      await deliverPendingTelegramNotifications(update.message.from.id, update.message.chat.id);
    }
    if (update.message?.chat?.type === "private" && update.message.from?.id && !update.message.from.is_bot && !update.message.successful_payment) {
      await saveSupportInboxMessage(update.message);
    }
    if (update.callback_query?.data === "fx:connect_guide") {
      await telegram("answerCallbackQuery",{callback_query_id:update.callback_query.id});
      await sendRichTelegramMessage(update.callback_query.message.chat.id,
        `<b>Инструкция по подключению FLAMEXBOT</b>\n\n1. Открой Telegram → Настройки → Telegram Business.\n2. Выбери «Чат-боты» → «Добавить чат-бота».\n3. Найди FLAMEXBOT и подключи его.\n4. Разреши доступ к сообщениям и отправке ответов. Для автоматического удаления сообщений также включи право удаления.\n5. Вернись в Mini App → Профиль и проверь статус подключения.`,
        "HTML",{inline_keyboard:[[{text:"Открыть FLAMEXBOT",web_app:{url:APP_URL}}]]});
    } else if (update.callback_query) await handleBusinessActionCallback(update.callback_query);
    if (update.message?.successful_payment) await handleSuccessfulPayment(update.message);
    if (update.message?.chat?.type === "private" && update.message.from?.id
        && /^\/pro(?:@\w+)?(?:\s|$)/i.test((update.message.text ?? "").trim())) {
      await sendRichTelegramMessage(update.message.chat.id,
        "⭐ Тариф FLAMEX PRO упразднён. Все его возможности и дополнения перенесены в Premium. Используй /premium для покупки или продления.",
        "HTML");
    }
    if (update.message?.chat?.type === "private" && update.message.from?.id
        && /^\/premium(?:@\w+)?(?:\s|$)/i.test((update.message.text ?? "").trim())) {
      await sendTierInvoice(update.message.chat.id, update.message.from.id, "premium");
    }
    if (update.message?.chat?.type === "private" && typeof update.message.text === "string" &&
        /^\/ping(?:@\w+)?(?:\s|$)/i.test(update.message.text.trim())) {
      await sendRichTelegramMessage(
        update.message.chat.id,
        `${tgEmoji("success")} <b>PONG!</b> Бот запущен, webhook принимает обновления.`,
        "HTML",
      );
    }

    if (update.message?.chat?.type === "private" && typeof update.message.text === "string" &&
        /^\/status(?:@\w+)?(?:\s|$)/i.test(update.message.text.trim())) {
      const telegramUserId=String(update.message.from?.id ?? "");
      const {data:profile,error:profileError}=await admin.from("profiles").select("id").eq("telegram_id",telegramUserId).maybeSingle();
      if(profileError)throw profileError;
      const {data:connection,error:connectionError}=profile
        ? await admin.from("flamexbot_business_connections").select("is_enabled,rights").eq("profile_id",profile.id).maybeSingle()
        : {data:null,error:null};
      if(connectionError)throw connectionError;
      const connected=Boolean(connection?.is_enabled);
      const canReply=connection?.rights?.can_reply===true;
      const canDelete=connection?.rights?.can_delete_all_messages===true;
      await sendRichTelegramMessage(
        update.message.chat.id,
        `<b>FLAMEXBOT · статус</b>\n\n${connected?"🟢 Telegram Business подключён":"🔴 Telegram Business не подключён"}\n${canReply?"✓":"✕"} Отправка ответов\n${canDelete?"✓":"✕"} Удаление сообщений\n\nПроверка команд: <code>.ping</code> или <code>/ping</code> прямо в Business-переписке.\nСправка: /help`,
        "HTML",
      );
    }

    if (update.message?.chat?.type === "private" && typeof update.message.text === "string" &&
        /^[./](ping|help|inf|commands|mute|unmute|profile|afk|unafk|antimute|antimut|unantimute|unantimut|autoread|unautoread|autotyping|unautotyping|autovoice|unautovoice|mutestick|unmutestick|antimat|unantimat|timeprofile|bold|dumb|link|time|untime|streak|copyp|qr|id|chatid|date|calc|upper|lower|reverse|count|wordcount|choose|roll)(?:@\w+)?(?:\s|$)/i.test(update.message.text.trim())) {
      await sendRichTelegramMessage(
        update.message.chat.id,
        "Эта команда выполняется не в чате с ботом, а прямо в нужной личной переписке Telegram Business.\n\nОткрой диалог с человеком и отправь команду там. Для проверки бота используй /ping, для статуса подключения — /status.",
        "HTML",
      );
    }

    if (update.message?.chat?.type === "private" && typeof update.message.text === "string" &&
        /^\/(help|commands)(?:@\w+)?(?:\s|$)/i.test(update.message.text.trim())) {
      await sendRichTelegramMessage(
        update.message.chat.id,
        `<b>FLAMEXBOT · помощь</b>

Привет! Я управляю возможностями FLAMEXBOT и Telegram Business.

<b>Важно:</b> команды .mute, .unmute, .antimute и остальные команды управления нужно отправлять <b>прямо в переписке с нужным человеком</b>, а не сюда в личные сообщения боту.

Открой FLAMEXBOT, подключи Telegram Business и выдай необходимые разрешения. Затем отправь <code>.help</code> или <code>/help</code> в нужном диалоге.

Команды без адреса собеседника и без @username — бот определит текущий чат автоматически. Статус подключения: /status. Тарифы: /premium. Все прежние PRO-возможности входят в Premium.`,
        "HTML",
        { inline_keyboard: [[{ text: "Открыть FLAMEXBOT", web_app: { url: APP_URL } }]] },
      );
    }

    if (update.business_connection) await saveBusinessConnection(update.business_connection);
    if (update.business_message?.chat?.type === "private") {
      await ensureBusinessConnection(update.business_message.business_connection_id);
      const { data: ownerConnection, error: ownerConnectionError } = await admin.from("flamexbot_business_connections")
        .select("profile_id,telegram_user_id,connection_id,is_enabled,rights")
        .eq("connection_id", update.business_message.business_connection_id).maybeSingle();
      if (ownerConnectionError) throw ownerConnectionError;
      const ownerBan = ownerConnection?.telegram_user_id
        ? await getTelegramBan(ownerConnection.telegram_user_id)
        : null;
      if (ownerBan) {
        console.warn("Ignored Business update for banned FLAMEXBOT owner", ownerConnection.telegram_user_id);
        return new Response("OK", { status: 200 });
      }
      const hasCommandPrefix = typeof update.business_message.text === "string" &&
        /^[./][a-z]/i.test(update.business_message.text.trim()) &&
        update.business_message.from?.id != null;
      const isBusinessCommand = hasCommandPrefix &&
        String(update.business_message.from.id) === String(ownerConnection?.telegram_user_id ?? "");
      // Only commands authored by the connected account owner are executable.
      // Messages from the other participant (including dot-prefixed text) stay in the archive.
      if (!isBusinessCommand) {
        await saveBusinessMessage(update.business_message, ownerConnection);
      }
      if (isBusinessCommand) {
        const commandToken = update.business_message.text.trim().slice(1).split(/\s+/)[0].replace(/@\w+$/,"").toLowerCase();
        console.log("business command candidate", JSON.stringify({
          command: commandToken,
          chat_id: String(update.business_message.chat.id),
          sender_id: String(update.business_message.from.id),
          connection_found: Boolean(ownerConnection),
          connection_enabled: Boolean(ownerConnection?.is_enabled),
          sender_is_owner: String(update.business_message.from.id) === String(ownerConnection?.telegram_user_id ?? ""),
        }));
        if (ownerConnection?.is_enabled &&
            String(update.business_message.from.id) === String(ownerConnection.telegram_user_id)) {
          let handled = false;
          try {
            handled = await handleBusinessChatCommand(update.business_message, update.business_message.business_connection_id, ownerConnection);
            console.log("business command processed", JSON.stringify({ command: commandToken, handled: Boolean(handled) }));
          } catch (commandError) {
            const reason = String((commandError as any)?.message ?? commandError ?? "Неизвестная ошибка").slice(0, 240);
            console.error("Business command failed", JSON.stringify({
              command: commandToken, chat_id: String(update.business_message.chat.id),
              owner_id: String(ownerConnection.telegram_user_id), error: reason,
            }));
            try {
              const safeReason = reason.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
              await sendBusinessReply(
                update.business_message.business_connection_id,
                update.business_message.chat.id,
                `${tgEmoji("warning")} <b>Команда .${commandToken} не выполнена</b>\\nПричина: ${safeReason}\\nПопробуй ещё раз позже. Если ошибка повторяется, сообщи администратору FLAMEXBOT.`,
                "HTML",
              );
            } catch (replyError) {
              console.error("Could not report Business command failure:", (replyError as any)?.message ?? replyError);
            }
          }
          if (handled && ownerConnection.rights?.can_delete_sent_messages) {
            try {
              await telegram("deleteBusinessMessages", {
                business_connection_id: update.business_message.business_connection_id,
                message_ids: [update.business_message.message_id],
              });
            } catch (deleteError) {
              console.warn("Could not remove Business command message:", deleteError?.message ?? deleteError);
            }
          }
        }
      }
    }
    if (update.edited_business_message?.chat?.type === "private") await updateBusinessMessage(update.edited_business_message);
    if (update.deleted_business_messages?.chat?.type === "private") await deleteBusinessMessages(update.deleted_business_messages);
    if (update.message?.chat?.type === "private" && typeof update.message.text === "string" &&
        /^[/](start|app)(?:@\w+)?(?:\s+([A-Za-z0-9_-]+))?\s*$/i.test(update.message.text)) {
      const chatId = update.message.chat.id;
      const startMatch = /^\/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]+))?\s*$/i.exec(update.message.text.trim());
      const referralCode = startMatch?.[1]?.startsWith("ref_") ? startMatch[1].slice(4) : null;
      if (referralCode && update.message.from?.id) {
        const {error:referralError}=await admin.rpc("record_flamexbot_referral",{
          p_telegram_user_id:String(update.message.from.id),p_code:referralCode
        });
        if(referralError)console.warn("Referral link processing skipped:",referralError.message);
      }
      await enableBusinessUpdates();
      await telegram("setMyCommands", {
        scope: { type: "all_private_chats" },
        language_code: "ru",
        commands: [
          { command: "start", description: "Запустить FLAMEXBOT" },
          { command: "app", description: "Открыть Mini App" },
          { command: "ping", description: "Проверить связь с ботом" },
          { command: "status", description: "Статус Telegram Business" },
          { command: "help", description: "Справка и команды" },
          { command: "commands", description: "Список доступных команд" },
          { command: "premium", description: "Купить или продлить Premium" },
          { command: "pro", description: "Купить или продлить FLAMEX PRO" },
        ],
      });
      await telegram("setChatMenuButton", {
        chat_id: chatId,
        menu_button: { type: "web_app", text: "Открыть FLAMEXBOT", web_app: { url: APP_URL } },
      });
      await sendRichTelegramMessage(
        chatId,
        `${tgEmoji("sparkles")} <b>Добро пожаловать в FLAMEXBOT!</b>

${tgEmoji("users")} Общайся с друзьями, поддерживай ваши огоньки и возвращайся к важным диалогам каждый день.

${tgEmoji("settings")} Подключение Telegram Business и управление разрешениями доступны в профиле приложения.`,
        "HTML",
        { inline_keyboard: [
          [{ text: "Открыть FLAMEXBOT", web_app: { url: APP_URL } }],
          [{ text: "📖 Инструкция к подключению", callback_data: "fx:connect_guide" }]
        ] },
      );
    }

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("flamexbot-bot webhook processing error:", error?.message ?? error);
    throw error;
  } finally {
    console.log("telegram update processed", JSON.stringify({update_id:update.update_id??null,duration_ms:Date.now()-startedAt}));
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "GET") {
    try {
      const [me, webhook] = await Promise.all([
        telegram("getMe", {}),
        telegram("getWebhookInfo", {}),
      ]);
      return new Response(JSON.stringify({
        ok: true,
        bot_username: me.username ?? null,
        can_connect_to_business: me.can_connect_to_business === true,
        webhook_url_set: Boolean(webhook.url),
        webhook_url_matches: webhook.url === WEBHOOK_URL,
        allowed_updates: webhook.allowed_updates ?? [],
        pending_update_count: webhook.pending_update_count ?? 0,
        last_error_message: webhook.last_error_message ?? null,
        last_error_date: webhook.last_error_date ?? null,
      }), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    } catch (error) {
      console.error("flamexbot-bot diagnostics error:", error?.message ?? error);
      return new Response(JSON.stringify({ ok: false, error: "Telegram diagnostics failed" }), {
        status: 502, headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    }
  }
  if (req.method !== "POST") return new Response("OK", { status: 200 });
  if (req.headers.get("x-telegram-bot-api-secret-token") !== WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  let update: any;
  try {
    update = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const updateId = Number(update.update_id);
  const hasUpdateId = Number.isSafeInteger(updateId) && updateId >= 0;
  let claimed = false;
  if (hasUpdateId && admin) {
    const { data: claimResult, error: claimError } = await admin.rpc("claim_flamexbot_telegram_update_v2", {
      p_update_id: updateId,
    });
    if (claimError) {
      console.error("Telegram update claim failed:", claimError.message);
      return new Response("Webhook temporarily unavailable", { status: 500 });
    }
    if (claimResult === "completed") return new Response("OK", { status: 200 });
    claimed = claimResult === "claimed";
    if (!claimed) {
      // Keep Telegram retrying an in-flight or uncertain update; only completed updates get 200.
      return new Response("Update is still processing; retry later", {
        status: 503,
        headers: { "Retry-After": "2" },
      });
    }
  }

  try {
    // Telegram requires an answer to pre-checkout within 10 seconds.
    if (update.pre_checkout_query) await handlePreCheckout(update.pre_checkout_query);
    await processTelegramUpdate(update);
    if (claimed && admin) {
      const { error: completeError } = await admin.rpc("complete_flamexbot_telegram_update", {
        p_update_id: updateId,
      });
      if (completeError) throw completeError;
    }
    return new Response("OK", { status: 200, headers: { "Connection": "keep-alive" } });
  } catch (error) {
    console.error("Telegram webhook failed; update will be retried:", error?.message ?? error);
    if (claimed && admin) {
      const { error: failError } = await admin.rpc("fail_flamexbot_telegram_update", {
        p_update_id: updateId,
        p_error: String(error?.message ?? error ?? "Unknown webhook error"),
      });
      if (failError) console.error("Could not record failed Telegram update:", failError.message);
    }
    return new Response("Webhook processing failed", { status: 500 });
  }
});
