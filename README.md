# ChatGPT Local Backup

A local-first Chrome/Edge extension that backs up the visible ChatGPT conversation into browser IndexedDB and lets you search or export saved conversations.

The default interface language is Chinese. You can switch between Chinese and English from the popup or backup library.

## What It Does

- Watches `chatgpt.com` and `chat.openai.com` pages.
- Saves visible user and assistant messages to local browser storage.
- Updates assistant messages while a response is still generating.
- Opens a local backup library from the extension popup.
- Exports one conversation as Markdown or JSON.
- Exports all local backups as Markdown or JSON.
- Supports Chinese and English UI, with Chinese as the default.
- Does not read cookies, passwords, tokens, or browser history.
- Does not call private ChatGPT APIs.
- Does not automatically crawl old conversations in the background.

## Install For Chrome

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this folder:

   ```text
   d:\chat_export\chatgpt-backup-extension
   ```

5. Open `https://chatgpt.com` and start or open a conversation.
6. Click the extension icon to check status or open the backup library.
7. Use the popup checkbox to pause or resume automatic local backup.
8. Use the language selector to switch between Chinese and English.

## Install For Edge

1. Open `edge://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this folder:

   ```text
   d:\chat_export\chatgpt-backup-extension
   ```

5. Open `https://chatgpt.com` and use the extension.
6. Use the popup checkbox to pause or resume automatic local backup.
7. Use the language selector to switch between Chinese and English.

## Current Limits

- It only backs up conversations after the extension is installed and active.
- It can back up old conversations only when you open them and their content is visible.
- It does not recover conversations from a locked or banned account if they were never backed up.
- Page structure changes on ChatGPT may require updating `src/content.js`.
- Attachments, images, Canvas content, and voice data are not fully supported in this first version.

## Privacy Model

Data stays in the local browser profile by default. The extension stores conversation records in IndexedDB and uses the browser download API only when you explicitly export files.

To delete local data, open the backup library and click `Clear all`.

## Project Structure

```text
manifest.json
src/
  content.js
  db.js
  export.js
  popup.html
  popup.js
  service-worker.js
  styles.css
  vault.html
  vault.js
```
