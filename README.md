# Discord Bot — Setup Guide

This bot includes:
- `/ping` — check the bot is alive (reply is hidden/ephemeral)
- **Activity role tracking**: if a member has a "required" role and sends a message or reacts to one, they get a matching "active" role. If they go 10 minutes without any message/reaction, the active role is automatically removed. Fully inactive members, or members without the required role, are untouched.
- **Activity role management** (needs the **Manage Roles** permission):
  - `/addactivityrole required:<role> active:<role>` — adds a new pair, or updates the active role if that required role is already configured
  - `/removeactivityrole required:<role>` — removes the pair for that required role
  - `/listactivityroles` — shows all currently configured pairs
- **`/embed` — an in-Discord embed builder** (like Discohook), needs the **Manage Messages** permission:
  - `/embed create` — start building a new embed message. A popup lets you set title, description, color, footer, image. Buttons let you add fields, an author, a thumbnail, more embeds (up to 10 per message), and buttons on the final message (up to 5) — link buttons, reply buttons, or **Application**/**Ticket** buttons (see below).
  - `/embed edit message_id:<id>` — pulls up a message the bot already sent **in the same channel** and lets you modify it with the same tools, then save the changes back to that message instead of sending a new one.
- **`/setup` — dropdown-based configuration**, needs the **Manage Server** permission (see below)
- **`/request` — moderation/server-management actions restricted to whichever roles you design** (see below)
- **Join/leave messages, auto-role, and invite tracking** (see below)
- **Scam detection** (see below)

### Permissions model
Commands here each need the *specific* Discord permission that matches what they do — not a blanket Administrator requirement. If a member lacks the needed permission, the bot replies with a hidden (ephemeral) message telling them exactly which permission is missing, rather than the command silently failing or Discord hiding it entirely. `/request` is the one exception — see its own section below for why.

### `/setup` — configure everything with dropdown pickers
Instead of copy-pasting channel/role IDs into `config.js`, you can pick them directly in Discord (needs **Manage Server**):
- `/setup general` — join channel, leave channel, auto-role, ticket support role, ticket category
- `/setup applications` — the 4 application channels (submission/pending/accepted/denied)
- `/setup automod` — one click creates two starter AutoMod rules (a scam-keyword filter and a mention-spam filter) — needs the bot to have **Manage Server** too

Each dropdown saves the instant you pick something — there's no separate "finish" step. Whatever you set via `/setup` takes priority over the matching value in `config.js`, so you can mix both approaches freely (e.g. set most things via `/setup`, but still hand-edit the application questions or scam-detection wording in `config.js`).

### `/request` — moderation actions for roles you design, without needing the raw permission
This is different from every other command here on purpose. Instead of checking a Discord permission in code, `/request` is set to be invisible/unusable by everyone by default — access is granted entirely through **Server Settings → Integrations → [your bot] → `/request`**, where you pick exactly which roles can use it. This means a role like "Helper" can kick/mute/manage channels through the bot *without* actually holding Kick Members, Ban Members, etc. themselves — the bot performs the action using its own permissions, not theirs.

Subcommands: `kick`, `ban`, `unban`, `mute`, `unmute`, `createchannel`, `deletechannel`, `editchannel`, `createrole`, `deleterole`. (Deliberately excluded: deleting other people's regular messages — that wasn't asked for.)

**You need to do the Integrations step yourself** once the bot is running — I can't pre-configure which roles you want, since that's specific to how your server is structured.

### Join/leave messages, auto-role, and invite tracking
Configurable via `/setup general`, or by hand in `config.js` under `joinLeaveSystem`:
- **Auto-role**: whichever role you set is given the instant someone joins — no delay, no conditions.
- **Join/leave messages**: sent to the channels you configure. The join message supports these placeholders — edit the templates in `config.js`:
  - `{user}` — mentions the member
  - `{username}` — their username as plain text
  - `{server}` — the server's name
  - `{memberCount}` — current member count
  - `{date}` — when they joined, Discord-formatted
  - `{inviter}` — who invited them (their tag), or "Unknown" if it can't be determined
  - `{inviteCode}` — the invite code used, or "Unknown"
  - `{inviteUses}` — how many total times that invite has been used

**How invite tracking works, and its limits:** Discord doesn't tell a bot directly "this invite was used" — instead, the bot keeps a cache of every invite's use-count, and when someone joins, it re-fetches and compares to see which one went up. This needs the bot to have the **Manage Server** permission to read invites at all. It can't attribute a join to an invite if: the person joined via a server's Vanity URL, the invite was a temporary one-time link that's already expired/deleted by the time the comparison runs, or the bot was offline when a relevant invite was created/deleted (it resyncs on every restart, so this self-heals). In these cases `{inviter}` etc. will just show "Unknown" rather than guessing wrong.

### Application system
Add a button in `/embed create` with style **`application`** (or `app`) to create an "Apply" button. When clicked:
1. The applicant fills out a short form (questions come from `config.js`, up to 5).
2. The application posts to your **submission channel** with Accept/Deny buttons for staff, and a copy logs to your **pending channel**.
3. When staff clicks Accept or Deny (Administrator or Manage Messages only), it logs to your **accepted** or **denied** channel, removes the pending-log copy, and DMs the applicant automatically.

Set the 4 channels via `/setup applications`, or by hand in `config.js` under `applicationSystem` (right-click a channel → Copy Channel ID, needs Developer Mode on).

**Note:** right now there's one shared application form for the whole server (not different forms per button). If you need multiple distinct application types later, that's an extension, not something already built in.

### Ticket system
Add a button in `/embed create` with style **`ticket`** to create an "Open Ticket" button. When clicked:
1. The user answers a couple of quick questions (from `config.js`, up to 5 — keep it short).
2. A private channel is created just for them, named `ticket-username`, visible only to them, the bot, and your support role (if configured).
3. Their answers post in that channel along with a **Close Ticket** button, which the opener or staff can use to delete the channel (with a 5-second warning first).

Set the support role/category via `/setup general`, or by hand in `config.js` under `ticketSystem`. Both can be left blank.

**Note:** there's one shared ticket type ("support") right now, not separate categories like "bug report" vs "purchase inquiry" with different questions each.

### What `/embed` doesn't do (yet)
This covers the core embed-building experience, but it isn't a full Discohook replacement. It does not support: raw JSON import/export, sending via an external webhook, saved drafts that persist as named templates, buttons that assign/remove roles, or select menus. Let me know if any of these matter to you and they can be added.

### Scam detection
Every message with a link or attachment is checked against several common Discord scam categories:
- **Fake Nitro/gift giveaways** — off-brand domains, "claim your gift" style wording
- **Crypto/NFT mint & wallet-drainer links** — "free mint", "connect your wallet", "airdrop" style wording, and known impersonation domains
- **Steam/game-account phishing & inflated trade offers**
- **Fake account-threat / impersonated-support messages** — "your account will be banned", "confirm your identity"
- **"You've been exposed" blackmail-invite scams**
- **Malware disguised as a game/file** — executable-style attachments (.exe/.scr/.bat/.apk/etc.), or any file paired with "test this out" style wording
- **Rapid-fire link/image spam** — the classic compromised-account pattern of blasting the same thing repeatedly

Staff (Administrator or Manage Messages) are exempt from this check. When a message is flagged, the bot deletes it, DMs the sender, and bans them — configurable in `config.js` under `scamDetection`, including the ban DM message and (once you have one) an appeal server invite link. The keyword and domain lists live at the top of `scamDetector.js` and can be extended any time.

**Two honest limits, not fixable by adding more code:**
1. **This can only see messages posted inside the server.** Most Discord scams (the classic "hey is this you" Nitro DM, fake support tickets) happen in private DMs between users, which a server bot has no access to at all.
2. **This is text/pattern matching, not true AI image or link-content scanning** — it judges wording, file extensions, and posting behavior, not what's actually inside an image or where a shortened link ultimately leads. A patient, one-off scammer using an older account and none of the flagged wording could still slip through. For NSFW images specifically, use Discord's own **Explicit Media Filter** under Server Settings → Safety Setup — it's more accurate than anything a bot can do here and needs no code.

## Files
- `index.js` — the bot itself
- `config.js` — general settings and fallback values for everything below
- `activityRoles.json` — the current activity role pairs (auto-updated by the admin commands)
- `roleManager.js` — reads/writes `activityRoles.json`
- `activityTracker.js` — the logic that grants/removes activity roles
- `embedBuilder.js` — the logic behind `/embed` (modals, buttons, previews), including saving in-progress sessions to `embedSessions.json` so a bot restart doesn't wipe out work in progress
- `applicationSystem.js` / `applicationStore.js` — the application form, review, and decision logic (persisted to `applications.json`)
- `ticketSystem.js` — the ticket form and private-channel logic
- `scamDetector.js` — flags likely scam messages (see above)
- `buttonRegistry.js` — stores what each "reply" button says when clicked, in `buttonReplies.json` (created automatically the first time you add one)
- `settingsStore.js` — persists whatever you configure via `/setup`, in `settings.json` (created automatically)
- `inviteTracker.js` — caches invite use-counts to figure out who invited a new member
- `joinLeaveSystem.js` — fills in the `{placeholders}` for join/leave messages
- `setupWizard.js` — builds the dropdown pickers behind `/setup` and creates the AutoMod rules
- `permissions.js` — the shared "does this member have the right permission" check with its ephemeral denial message
- `requestCommands.js` — the actual actions behind `/request` (kick, ban, channel/role management, etc.)
- `keep_alive.js` — tiny web server for the UptimeRobot workaround
- `package.json` — dependencies
- `.env.example` — shows what secrets you need (don't put real values in this file)

## ⚠️ Double-check before running
In `activityRoles.json`, the first role pair has the **same ID** for both the required role and the active role (`1541392341862973530`). If that's intentional, no action needed — otherwise, once the bot is running, an admin can fix it instantly with `/addactivityrole required:<that role> active:<correct role>`.

## A note on persistence
`activityRoles.json`, `buttonReplies.json`, `embedSessions.json`, `applications.json`, and `settings.json` are plain files created automatically on disk. They persist as long as the host isn't wiped, but they're not a proper database — if you ever move hosts, remember to bring these files with you.

One limit that no amount of file-saving can fix: Discord itself invalidates a message's buttons about 15 minutes after they were shown. So `embedSessions.json` protects your in-progress embed if the *bot* restarts (a Railway/Replit redeploy, a crash) — but if more than ~15 minutes pass since you last touched an `/embed` session, clicking its buttons will fail regardless, because Discord — not the bot — has expired that interaction. Just run `/embed create` (or `/embed edit`) again in that case; nothing is lost from your side, you just need a fresh set of buttons.

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
   - Under "Bot Permissions," check `Send Messages`, `Read Messages/View Channels`, `Embed Links`, `Manage Roles`, `Ban Members`, `Manage Messages`, `Manage Channels`, `Moderate Members` (needed for `/request mute`/`unmute`), and `Manage Server` (needed for `/setup`, AutoMod rule creation, and invite tracking).
   - Copy the generated URL at the bottom, open it in your browser, and choose a server to add the bot to.

---

## Step 2: Set up Replit

1. Go to https://replit.com and sign up/log in (free).
2. Tap **Create Repl** → choose the **Node.js** template.
3. Delete any starter files Replit creates, then upload these files: `index.js`, `config.js`, `activityRoles.json`, `roleManager.js`, `activityTracker.js`, `embedBuilder.js`, `buttonRegistry.js`, `scamDetector.js`, `applicationSystem.js`, `applicationStore.js`, `ticketSystem.js`, `settingsStore.js`, `inviteTracker.js`, `joinLeaveSystem.js`, `setupWizard.js`, `permissions.js`, `requestCommands.js`, `keep_alive.js`, `package.json`.
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

---

## One more setup step: granting roles access to `/request`

`/request` is invisible to everyone until you explicitly grant it, since that's the whole point — trusted roles get access without needing the raw Discord permission.

1. Go to **Server Settings → Integrations**.
2. Find your bot in the list and click it.
3. You'll see a list of its commands — find `/request`.
4. Click it, then add whichever roles (or specific people) you want to be able to use it.
5. Save. Those roles can now run `/request kick`, `/request ban`, etc., even without holding Kick Members/Ban Members themselves — the bot performs the action using its own permissions.

If you skip this step, `/request` simply won't appear as usable for anyone except the server owner.
