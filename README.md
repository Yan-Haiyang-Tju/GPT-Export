# ChatGPT 本地备份 / ChatGPT Local Backup

**Language / 语言**: [简体中文](#简体中文) | [English](#english)

---

## 简体中文

一个本地优先的 Chrome / Edge 浏览器扩展，用于把当前可见的 ChatGPT 会话自动备份到浏览器本地 IndexedDB，并支持查看、搜索和导出。

默认界面语言是中文。你可以在插件弹窗或备份库中切换中文和 English。

### 功能特性

- 监听 `chatgpt.com` 和 `chat.openai.com` 页面。
- 自动保存当前页面可见的用户消息和 ChatGPT 回复。
- ChatGPT 回复生成过程中会持续更新本地草稿。
- 从插件弹窗打开本地备份库。
- 查看、搜索、收藏、删除本地备份会话。
- 单个会话可导出为 Markdown 或 JSON。
- 全部本地备份可批量导出为 Markdown 或 JSON。
- 支持中文和英文界面，默认中文。
- 不读取 cookies、密码、token 或浏览器历史记录。
- 不调用 ChatGPT 私有接口。
- 不在后台自动批量爬取历史会话。

### Chrome 安装方式

1. 打开 `chrome://extensions`。
2. 开启 `Developer mode / 开发者模式`。
3. 点击 `Load unpacked / 加载已解压的扩展程序`。
4. 选择本项目文件夹：

   ```text
   d:\chat_export\chatgpt-backup-extension
   ```

5. 打开 `https://chatgpt.com`，开始新会话或打开已有会话。
6. 点击浏览器右上角插件图标，查看备份状态或打开备份库。
7. 使用弹窗里的开关暂停或恢复自动备份。
8. 使用语言选择器在中文和英文之间切换。

### Edge 安装方式

1. 打开 `edge://extensions`。
2. 开启 `Developer mode / 开发者模式`。
3. 点击 `Load unpacked / 加载已解压的扩展程序`。
4. 选择本项目文件夹：

   ```text
   d:\chat_export\chatgpt-backup-extension
   ```

5. 打开 `https://chatgpt.com` 并正常使用。
6. 使用弹窗里的开关暂停或恢复自动备份。
7. 使用语言选择器在中文和英文之间切换。

### 使用方式

安装后，打开 ChatGPT 会话页面即可自动备份当前可见内容。页面右下角会显示备份状态，例如：

```text
备份：监听中
备份：保存中
备份：已保存 6 条消息
```

你也可以点击插件图标：

- 查看当前页面是否已识别。
- 手动点击 `立即保存`。
- 导出当前会话。
- 打开备份库。
- 暂停或恢复自动备份。

### 当前限制

- 只能备份插件安装并启用之后产生或打开过的会话。
- 历史会话需要你手动打开，且内容已经加载到页面中，插件才能备份。
- 如果账号已经无法访问，且某些会话此前从未备份过，插件无法恢复这些内容。
- ChatGPT 页面结构变化后，可能需要更新 `src/content.js`。
- 第一版主要备份文本内容，暂不完整支持附件、图片、Canvas、语音等内容。

### 隐私说明

默认情况下，数据只保存在当前浏览器配置的本地 IndexedDB 中。插件只在你主动导出时使用浏览器下载能力生成 Markdown 或 JSON 文件。

插件不会读取或保存：

- ChatGPT 账号密码
- cookies
- token
- 浏览器历史记录
- 其他网站内容

如需删除本地数据，请打开备份库并点击 `清空全部`。

### 项目结构

```text
manifest.json
src/
  content.js
  db.js
  export.js
  i18n.js
  popup.html
  popup.js
  service-worker.js
  styles.css
  vault.html
  vault.js
```

---

## English

A local-first Chrome / Edge browser extension that automatically backs up the currently visible ChatGPT conversation into browser IndexedDB, then lets you view, search, and export saved conversations.

The default interface language is Chinese. You can switch between Chinese and English from the extension popup or the backup library.

### Features

- Watches `chatgpt.com` and `chat.openai.com` pages.
- Automatically saves visible user messages and ChatGPT responses.
- Updates the local draft while a ChatGPT response is still generating.
- Opens a local backup library from the extension popup.
- Lets you view, search, favorite, and delete local backup conversations.
- Exports one conversation as Markdown or JSON.
- Exports all local backups as Markdown or JSON.
- Supports Chinese and English UI, with Chinese as the default.
- Does not read cookies, passwords, tokens, or browser history.
- Does not call private ChatGPT APIs.
- Does not automatically crawl old conversations in the background.

### Install For Chrome

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this project folder:

   ```text
   d:\chat_export\chatgpt-backup-extension
   ```

5. Open `https://chatgpt.com` and start or open a conversation.
6. Click the extension icon to check status or open the backup library.
7. Use the popup checkbox to pause or resume automatic local backup.
8. Use the language selector to switch between Chinese and English.

### Install For Edge

1. Open `edge://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select this project folder:

   ```text
   d:\chat_export\chatgpt-backup-extension
   ```

5. Open `https://chatgpt.com` and use the extension.
6. Use the popup checkbox to pause or resume automatic local backup.
7. Use the language selector to switch between Chinese and English.

### Usage

After installation, open a ChatGPT conversation page and the extension will automatically back up the currently visible content. A small status badge appears in the lower-right corner, for example:

```text
Backup: watching
Backup: saving
Backup: saved 6 messages
```

You can also click the extension icon to:

- Check whether the current page is detected.
- Click `Save now` manually.
- Export the current conversation.
- Open the backup library.
- Pause or resume automatic backup.

### Current Limits

- It only backs up conversations after the extension is installed and active.
- It can back up old conversations only when you open them and their content is visible.
- It does not recover conversations from a locked or banned account if they were never backed up.
- Page structure changes on ChatGPT may require updating `src/content.js`.
- This first version mainly backs up text content. Attachments, images, Canvas content, and voice data are not fully supported yet.

### Privacy Model

By default, data stays in the local IndexedDB of the current browser profile. The extension uses the browser download API only when you explicitly export Markdown or JSON files.

The extension does not read or save:

- ChatGPT account passwords
- cookies
- tokens
- browser history
- content from unrelated websites

To delete local data, open the backup library and click `Clear all`.

### Project Structure

```text
manifest.json
src/
  content.js
  db.js
  export.js
  i18n.js
  popup.html
  popup.js
  service-worker.js
  styles.css
  vault.html
  vault.js
```
