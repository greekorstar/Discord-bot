# Discord Bot — Setup Guide

This bot includes:
- Slash commands: `/ping`, `/hello`, `/userinfo`, `/serverinfo`, `/avatar`, `/roll`
- **Activity role tracking**: if a member has a "required" role and sends a message or reacts to one, they get a matching "active" role. If they go 10 minutes without any message/reaction, the active role is automatically removed. Fully inactive members, or members without the required role, are untouched.
- **Admin-only management commands** to add, remove, and list activity role pairs live in Discord — no file editing needed after initial setup:
  - `/addactivityrole required:<role> active:<role>` — adds a new pair, or updates the active role if that required role is already configured
  - `/removeactivityrole required:<role>` — removes the pair for that required role
  - `/listactivityroles` — shows all currently configured pairs
  - These are restricted to members with the **Administrator** permission. (Server owners can further restrict them per-role in Server Settings → Integrations if you want finer control than just "Administrator.")

## Files
- `index.js` — the bot itself
- `config.js` — the inactivity timeout setting
- `activityRoles.json` — the current role pairs (auto-updated by the admin commands — you generally won't need to edit this by hand after setup)
- `roleManager.js` — reads/writes `activityRoles.json`
- `activityTracker.js` — the logic that grants/removes activity roles
- `keep_alive.js` — tiny web server for the UptimeRobot workaround
- `package.json` — dependencies
- `.env.example` — shows what secrets you need (don't put real values in this file)

## ⚠️ Double-check before running
In `activityRoles.json`, the first role pair has the **same ID** for both the required role and the active role (`1541392341862973530`). If that's intentional, no action needed — otherwise, once the bot is running, an admin can fix it instantly with `/addactivityrole required:<that role> active:<correct role>`.

## A note on persistence
`activityRoles.json` is a plain file on Replit's disk. It persists as long as your Repl isn't deleted, but it's not a proper database — if you ever move hosts, remember to bring this file with you.

## Important: Bot permissions & role hierarchy
For the bot to be able to add/remove roles, two things must be true:
1. The bot needs the **Manage Roles** permission (when generating the invite link in Step 1 below, make sure this is checked).
2. In **Server Settings → Roles**, the bot's own role must be positioned **above** every "active" role it needs to assign. Discord blocks bots from managing roles higher than or equal to their own position. Drag the bot's role up if needed.

If role grants/removals silently fail, check the Replit console logs — errors are printed there with a hint about what to fix.

---

## Step 1: Create the bot on Discord's Developer Portal

1. Go to https://discord.com/developers/applications
2. Click **New Application**, give it a name, click **Create**.
3. In the left sidebar, click **Bot**.
4. Click **Reset Token** (or **Add Bot** if prompted), then copy the token that appears.
   - This is your `DISCORD_TOKEN`. Keep it secret — never share it or post it publicly.
5. Scroll down and turn ON **Message Content Intent** AND **Server Members Intent** under "Privileged Gateway Intents." Both are required for activity tracking to work.
6. In the left sidebar, click **OAuth2 → General**. Copy the **Client ID** at the top.
   - This is your `CLIENT_ID`.
7. Still in OAuth2, go to **URL Generator**:
   - Under "Scopes," check `bot` and `applications.commands`.
   - Under "Bot Permissions," check `Send Messages`, `Read Messages/View Channels`, `Embed Links`, and `Manage Roles`.
   - Copy the generated URL at the bottom, open it in your browser, and choose a server to add the bot to.

---

## Step 2: Set up Replit

1. Go to https://replit.com and sign up/log in (free).
2. Tap **Create Repl** → choose the **Node.js** template.
3. Delete any starter files Replit creates, then upload these files: `index.js`, `config.js`, `activityRoles.json`, `roleManager.js`, `activityTracker.js`, `keep_alive.js`, `package.json`.
   - On mobile: tap the three-dot menu in the file panel → **Upload file** for each one.
4. Go to the **Secrets** tab (lock icon in the left sidebar). Add two secrets:
   - Key: `DISCORD_TOKEN` → Value: (the token from Step 1)
   - Key: `CLIENT_ID` → Value: (the client ID from Step 1)
   - (Secrets replace the `.env` file — Replit injects these automatically, so you don't need to upload `.env.example` as a real `.env`.)
5. Tap the big green **Run** button. Replit will install dependencies automatically from `package.json`.
6. Check the console — you should see `Logged in as YourBotName#1234` and `Keep-alive server is running on port 3000`.
7. Go to your Discord server and try typing `/ping` — it should respond.

If slash commands don't show up right away, wait a minute or two — Discord can take a bit to register them globally.

---

## Step 3: Keep it running with UptimeRobot (the free workaround)

Replit's free tier puts projects to sleep after inactivity. This workaround pings your bot every few minutes so it looks "active."

**Note:** this isn't an officially guaranteed 24/7 solution — Replit's actual supported always-on option is a paid Reserved VM deployment. This workaround is the best free option, but you may occasionally see brief downtime or restarts.

1. While your Repl is running, find its web URL — it's shown at the top of the webview panel, usually something like `https://your-repl-name.your-username.repl.co`.
2. Go to https://uptimerobot.com and sign up for free.
3. Click **Add New Monitor**:
   - Monitor Type: **HTTP(s)**
   - Friendly Name: anything, e.g. "Discord Bot"
   - URL: paste your Repl's URL from step 1
   - Monitoring Interval: 5 minutes
4. Click **Create Monitor**.

UptimeRobot will now ping your bot every 5 minutes, which should keep Replit from putting it to sleep.

---

## Customizing the bot

Once it's running, tell me what other features or commands you want and I'll add them to `index.js`.
