"use strict";

/**
 * Заготовка уведомлений: подключите TELEGRAM_BOT_TOKEN / WHATSAPP_* в .env.
 * Сейчас только логирует — бизнес-логика бронирования не зависит от доставки.
 */
async function sendBookingNotification(booking, event) {
  const payload = {
    event,
    id: booking.id,
    client: booking.client_name,
    start: booking.start_at,
    employeeId: booking.employee_id,
  };
  console.info("[notifications]", JSON.stringify(payload));

  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    try {
      const text = `AlesSanna ${event}: #${booking.id} ${booking.client_name} @ ${booking.start_at}`;
      await fetch(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: process.env.TELEGRAM_CHAT_ID,
            text,
          }),
        }
      );
    } catch (e) {
      console.warn("[notifications] Telegram failed", e.message);
    }
  }
}

module.exports = { sendBookingNotification };
