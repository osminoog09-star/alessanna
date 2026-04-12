"use strict";

/**
 * Telegram deep-link login: user opens t.me/Bot?start=TOKEN from QR, presses Start,
 * we confirm qr_sessions and attach users.telegram_id.
 */
function startTelegramBot(db) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || String(token).trim() === "") {
    console.log("[telegram] TELEGRAM_BOT_TOKEN not set — bot disabled");
    return null;
  }

  let TelegramBot;
  try {
    TelegramBot = require("node-telegram-bot-api");
  } catch (e) {
    console.warn("[telegram] Install: npm install node-telegram-bot-api");
    return null;
  }

  const bot = new TelegramBot(token, { polling: true });

  bot.on("polling_error", (err) => {
    console.warn("[telegram] polling_error", err && err.message);
  });

  bot.onText(/^\/start(?:\s+(.+))?$/, (msg, match) => {
    const chatId = msg.chat.id;
    const payload = (match && match[1] ? String(match[1]).trim() : "") || "";

    if (!payload) {
      bot.sendMessage(chatId, "Scan the QR code on the work login screen, then tap Start here.");
      return;
    }

    const row = db.prepare("SELECT * FROM qr_sessions WHERE token = ?").get(payload);
    const now = Date.now();
    if (!row || row.status !== "pending" || row.expires_at < now) {
      bot.sendMessage(chatId, "This login link is invalid or expired. Generate a new QR on the computer.");
      return;
    }

    const telegramId = msg.from && msg.from.id;
    if (telegramId == null) {
      bot.sendMessage(chatId, "Could not read your Telegram account.");
      return;
    }

    const user = db.prepare("SELECT * FROM users WHERE telegram_id = ?").get(telegramId);
    if (!user) {
      bot.sendMessage(
        chatId,
        "Access denied. Your Telegram is not linked to a staff account. Ask an admin to set your telegram_id in the database (or use PATCH /api/crm/users/:id/telegram)."
      );
      return;
    }

    db.prepare("UPDATE qr_sessions SET status = 'confirmed', user_id = ? WHERE token = ?").run(user.id, payload);
    bot.sendMessage(chatId, "Login successful. You can return to the salon computer — it will open shortly.");
  });

  console.log("[telegram] Bot polling started");
  return bot;
}

module.exports = { startTelegramBot };
