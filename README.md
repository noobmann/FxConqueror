# Discord Server Manager (MEE6 + Carl Bot Hybrid) with Web Dashboard

A self-hosted, visual manager bot for your Discord server. It brings the power of welcome auto-roles, message deleting filters (like media-only channels), channel slowmode sliders, custom triggers, reaction roles, and moderation logging—all managed via a gorgeous local web dashboard.

---

## 🛠️ Step-by-Step Installation Guide

### Phase 1: Setup Your Discord Bot on Developer Portal

Before running the application, you need to register a bot application with Discord:

1. **Create Application:**
   - Go to the [Discord Developer Portal](https://discord.com/developers/applications).
   - Click the **New Application** button in the top right.
   - Name your application (e.g. `Server Manager`) and accept the terms.

2. **Generate Bot Token:**
   - On the left sidebar, click on **Bot**.
   - Click **Reset Token** and copy the long token code. 
   - Open `backend/.env` in your code editor and paste it next to `DISCORD_TOKEN=`:
     ```env
     DISCORD_TOKEN=your_copied_token_here
     ```

3. **Enable Privileged Gateway Intents (CRITICAL):**
   - Scroll down on the **Bot** page to find the **Privileged Gateway Intents** section.
   - **Toggle ON** the following switches:
     - **Presence Intent**
     - **Server Members Intent** (Needed for welcome greetings & auto-roles)
     - **Message Content Intent** (Needed to delete text-only posts and parse custom triggers)
   - Click **Save Changes**.

4. **Invite Bot to Your Server:**
   - On the left sidebar, click on **OAuth2** -> **URL Generator**.
   - Under **Scopes**, check the boxes for:
     - `bot`
     - `applications.commands`
   - Under **Bot Permissions** (which appears below), select:
     - **Manage Roles** (To grant reaction/auto roles)
     - **Manage Channels** (To update channel slowmodes)
     - **Read Messages/View Channels**
     - **Send Messages**
     - **Manage Messages** (To enforce photo-only deletion and delete warnings)
     - **Read Message History**
     - **Add Reactions**
   - Scroll down, copy the generated **OAuth2 URL**, paste it into your browser, select your server, and authorize the bot!

---

### Phase 2: Running the Project Locally

To run the bot and the configuration dashboard on your local machine, follow these steps:

#### 1. Start the Backend API & Bot Server
Open a terminal in the `backend/` directory:
```bash
# Install required npm packages
npm install

# Start the bot client and Express API in development mode
npm run dev
```
*You should see a message in the console indicating the API Server is running on port 5000 and the Discord bot is logging in.*

#### 2. Start the React Frontend Dashboard
Open a second terminal in the `frontend/` directory:
```bash
# Install web client packages
npm install

# Launch the Vite development server
npm run dev
```
*Vite will print a local URL (usually `http://localhost:3000`).*

Open **[http://localhost:3000](http://localhost:3000)** in your web browser. You will see your premium dark-mode dashboard loaded with your server stats, channel lists, and settings ready to customize!

---

## 🎯 Key Features and How They Work

### 📸 Photo-Only Channels
- **Use Case:** Perfect for screenshot/chart sharing or P&L sections where chat messages clutter the channel.
- **Config:** Toggle a channel "Photo-Only" in the **Channels & Rules** tab and click **Save**.
- **Action:** If anyone sends text without attaching an image, the bot deletes it instantly and leaves a temporary 5-second warning tag.

### ⏱️ Slowmode Control
- **Use Case:** Avoid spamming inside chat channels by setting custom delays (e.g. 1-2 minutes).
- **Config:** Adjust the slider next to any channel in the dashboard.
- **Action:** The bot updates Discord's native slowmode rate limits immediately.

### 👋 Welcome System & Auto-Roles
- **Welcome Channel:** Select a channel where new users will be welcomed.
- **Message Template:** Customize the message (e.g. `Welcome {user} to the trading server!`). `{user}` will mention the member.
- **Auto-Role:** Select a role (e.g. `Member` or `Trader`) to give immediately to any joining user.

### 🎭 Reaction Roles
- **Use Case:** Let members self-assign roles (like choosing channels or topics).
- **Config:** In the dashboard under **Welcome & Roles**, input a Discord Message ID, type an emoji, select the role, and click Add.
- **Action:** When users react to that message with that emoji, they get the role. Removing their reaction removes the role.

### 💬 Custom Triggers
- **Use Case:** Instant command replies (e.g., typing `!rules` returns server rules).
- **Config:** Enter a keyword (like `!website`) and a response, then save it in the **Custom Triggers** tab.
- **Action:** Bot listens for that exact keyword in chat and answers with the stored text.
