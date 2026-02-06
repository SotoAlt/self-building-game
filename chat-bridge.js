#!/usr/bin/env node
/**
 * Chat Bridge — connects external chat platforms to the game server
 *
 * Bridges Twitch, Discord, and Telegram chats so the Chaos Magician
 * can interact with audiences across platforms.
 *
 * Flow:
 *   Platform message → POST /api/chat/bridge → appears in game chat
 *   SSE agent messages → posted back to platform
 *
 * Usage:
 *   TWITCH_CHANNEL=mychannel TWITCH_TOKEN=oauth:xxx node chat-bridge.js
 *   DISCORD_TOKEN=xxx DISCORD_CHANNEL_ID=123 node chat-bridge.js
 *   TELEGRAM_TOKEN=xxx TELEGRAM_CHAT_ID=-123 node chat-bridge.js
 *
 * Enable multiple platforms simultaneously via env vars.
 */

const GAME_URL = process.env.GAME_SERVER_URL || 'http://localhost:3000';

// Track agent messages we've already relayed (prevent echo loops)
let lastRelayedMessageId = 0;

// Rate limiting for relay — prevent Telegram/Discord spam
let lastRelayTime = 0;
let lastBridgeMessageTime = 0;
const RELAY_COOLDOWN = 10000; // 10s between relayed agent messages
const BRIDGE_ACTIVITY_WINDOW = 60000; // only relay if bridge user was active in last 60s

// ============================================
// Game Server Communication
// ============================================

async function sendToGame(sender, platform, text) {
  lastBridgeMessageTime = Date.now();
  try {
    const res = await fetch(`${GAME_URL}/api/chat/bridge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender, platform, text })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error(`[Bridge] Send failed: ${err.error || res.status}`);
    }
  } catch (err) {
    console.error(`[Bridge] Game server unreachable: ${err.message}`);
  }
}

function startSSEListener(onAgentMessage) {
  const url = `${GAME_URL}/api/stream/events`;
  let retryDelay = 1000;

  function connect() {
    console.log('[SSE] Connecting to event stream...');

    fetch(url).then(res => {
      if (!res.ok) throw new Error(`SSE: ${res.status}`);
      retryDelay = 1000;
      console.log('[SSE] Connected');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      function read() {
        reader.read().then(({ done, value }) => {
          if (done) {
            console.log('[SSE] Stream ended, reconnecting...');
            setTimeout(connect, retryDelay);
            return;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop(); // keep incomplete line

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === 'chat_message' && event.senderType === 'agent') {
                if (event.id > lastRelayedMessageId) {
                  lastRelayedMessageId = event.id;
                  const now = Date.now();
                  // Only relay if bridge user was active recently and rate limit allows
                  const bridgeActive = now - lastBridgeMessageTime < BRIDGE_ACTIVITY_WINDOW;
                  const cooldownOk = now - lastRelayTime >= RELAY_COOLDOWN;
                  if (bridgeActive && cooldownOk) {
                    lastRelayTime = now;
                    onAgentMessage(event.sender, event.text);
                  }
                }
              }
            } catch {}
          }
          read();
        }).catch(err => {
          console.error(`[SSE] Read error: ${err.message}`);
          setTimeout(connect, retryDelay);
        });
      }
      read();
    }).catch(err => {
      console.error(`[SSE] Connection failed: ${err.message}`);
      retryDelay = Math.min(retryDelay * 2, 30000);
      setTimeout(connect, retryDelay);
    });
  }

  connect();
}

// ============================================
// Twitch (tmi.js / raw IRC)
// ============================================

async function startTwitch(onAgentMessage) {
  const channel = process.env.TWITCH_CHANNEL;
  const token = process.env.TWITCH_TOKEN; // oauth:xxx
  const username = process.env.TWITCH_USERNAME || 'chaos_magician_bot';

  if (!channel || !token) {
    console.log('[Twitch] Skipped — set TWITCH_CHANNEL and TWITCH_TOKEN to enable');
    return null;
  }

  // Dynamic import — tmi.js is optional
  let tmi;
  try {
    tmi = await import('tmi.js');
  } catch {
    console.error('[Twitch] tmi.js not installed. Run: npm install tmi.js');
    return null;
  }

  const client = new tmi.default.Client({
    connection: { reconnect: true, secure: true },
    identity: { username, password: token },
    channels: [channel]
  });

  client.on('message', (_channel, tags, message, self) => {
    if (self) return; // ignore own messages
    const sender = tags['display-name'] || tags.username || 'anonymous';
    console.log(`[Twitch] ${sender}: ${message}`);
    sendToGame(sender, 'twitch', message);
  });

  client.on('connected', () => {
    console.log(`[Twitch] Connected to #${channel}`);
  });

  await client.connect();

  // Return send function for relaying agent messages back
  return (agentName, text) => {
    client.say(channel, `${agentName}: ${text}`).catch(() => {});
  };
}

// ============================================
// Discord (discord.js)
// ============================================

async function startDiscord(onAgentMessage) {
  const token = process.env.DISCORD_TOKEN;
  const channelId = process.env.DISCORD_CHANNEL_ID;

  if (!token || !channelId) {
    console.log('[Discord] Skipped — set DISCORD_TOKEN and DISCORD_CHANNEL_ID to enable');
    return null;
  }

  let discord;
  try {
    discord = await import('discord.js');
  } catch {
    console.error('[Discord] discord.js not installed. Run: npm install discord.js');
    return null;
  }

  const { Client, GatewayIntentBits } = discord;
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ]
  });

  let targetChannel = null;

  client.on('ready', () => {
    targetChannel = client.channels.cache.get(channelId);
    console.log(`[Discord] Connected as ${client.user.tag}, channel: ${targetChannel?.name || channelId}`);
  });

  client.on('messageCreate', (msg) => {
    if (msg.author.bot) return;
    if (msg.channelId !== channelId) return;
    const sender = msg.member?.displayName || msg.author.username;
    console.log(`[Discord] ${sender}: ${msg.content}`);
    sendToGame(sender, 'discord', msg.content);
  });

  await client.login(token);

  return (agentName, text) => {
    if (targetChannel) {
      targetChannel.send(`**${agentName}**: ${text}`).catch(() => {});
    }
  };
}

// ============================================
// Telegram (node-telegram-bot-api)
// ============================================

async function startTelegram(onAgentMessage) {
  const token = process.env.TELEGRAM_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.log('[Telegram] Skipped — set TELEGRAM_TOKEN and TELEGRAM_CHAT_ID to enable');
    return null;
  }

  let TelegramBot;
  try {
    const mod = await import('node-telegram-bot-api');
    TelegramBot = mod.default;
  } catch {
    console.error('[Telegram] node-telegram-bot-api not installed. Run: npm install node-telegram-bot-api');
    return null;
  }

  const bot = new TelegramBot(token, { polling: true });

  bot.on('message', (msg) => {
    if (String(msg.chat.id) !== String(chatId)) return;
    if (msg.from.is_bot) return;
    const sender = msg.from.first_name || msg.from.username || 'anonymous';
    const text = msg.text;
    if (!text) return;
    console.log(`[Telegram] ${sender}: ${text}`);
    sendToGame(sender, 'telegram', text);
  });

  console.log(`[Telegram] Bot started, listening on chat ${chatId}`);

  return (agentName, text) => {
    bot.sendMessage(chatId, `*${agentName}*: ${text}`, { parse_mode: 'Markdown' }).catch(() => {});
  };
}

// ============================================
// Main
// ============================================

async function main() {
  console.log(`
╔═══════════════════════════════════════╗
║      Chaos Magician Chat Bridge      ║
║                                       ║
║  Game: ${GAME_URL.padEnd(30)}║
╚═══════════════════════════════════════╝
`);

  // Start all enabled platforms
  const senders = [];

  const twitchSend = await startTwitch();
  if (twitchSend) senders.push(twitchSend);

  const discordSend = await startDiscord();
  if (discordSend) senders.push(discordSend);

  const telegramSend = await startTelegram();
  if (telegramSend) senders.push(telegramSend);

  if (senders.length === 0) {
    console.error('\nNo platforms configured! Set env vars for at least one platform:');
    console.error('  Twitch:   TWITCH_CHANNEL + TWITCH_TOKEN');
    console.error('  Discord:  DISCORD_TOKEN + DISCORD_CHANNEL_ID');
    console.error('  Telegram: TELEGRAM_TOKEN + TELEGRAM_CHAT_ID');
    process.exit(1);
  }

  // Listen to SSE for agent messages and relay to all platforms
  startSSEListener((agentName, text) => {
    console.log(`[Relay] ${agentName}: ${text}`);
    for (const send of senders) {
      send(agentName, text);
    }
  });

  console.log(`\n[Bridge] Running with ${senders.length} platform(s). Press Ctrl+C to stop.`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
