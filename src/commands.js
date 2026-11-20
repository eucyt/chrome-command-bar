// Actions offered in the bar besides "go to this page". Type ">" to list them all.

import { setEnabled } from './autoclose.js';

/**
 * @typedef {object} CommandContext
 * @property {chrome.tabs.Tab | null} tab the tab the bar was opened on
 * @property {boolean} [autoClose] whether idle tabs are being closed
 */

/**
 * `view` commands switch what the bar lists instead of running something and closing it.
 * `icon` names a symbol in bar.html.
 * @type {{id: string, icon: string, title: string, keywords: string, needsTab?: boolean, when?: (ctx: CommandContext) => boolean, view?: string, run?: (ctx: CommandContext) => Promise<unknown>}[]}
 */
export const COMMANDS = [
  {
    id: 'new-tab',
    icon: 'plus',
    title: '新しいタブ',
    keywords: 'new tab shinki atarashii',
    run: ({ tab }) => chrome.tabs.create(tab ? { windowId: tab.windowId, index: tab.index + 1 } : {}),
  },
  {
    id: 'new-window',
    icon: 'window',
    title: '新しいウィンドウ',
    keywords: 'new window',
    run: () => chrome.windows.create({}),
  },
  {
    id: 'new-incognito',
    icon: 'incognito',
    title: 'シークレットウィンドウ',
    keywords: 'incognito private secret window',
    run: () => chrome.windows.create({ incognito: true }),
  },
  {
    id: 'close-tab',
    icon: 'x',
    title: 'このタブを閉じる',
    keywords: 'close tab tojiru',
    needsTab: true,
    run: ({ tab }) => chrome.tabs.remove(tab.id),
  },
  {
    id: 'duplicate-tab',
    icon: 'copy',
    title: 'タブを複製',
    keywords: 'duplicate clone tab fukusei',
    needsTab: true,
    run: ({ tab }) => chrome.tabs.duplicate(tab.id),
  },
  {
    id: 'pin-tab',
    icon: 'pin',
    title: 'ピン留めを切り替え',
    keywords: 'pin unpin tab pindome',
    needsTab: true,
    run: ({ tab }) => chrome.tabs.update(tab.id, { pinned: !tab.pinned }),
  },
  {
    id: 'mute-tab',
    icon: 'mute',
    title: 'ミュートを切り替え',
    keywords: 'mute unmute sound audio',
    needsTab: true,
    run: ({ tab }) => chrome.tabs.update(tab.id, { muted: !tab.mutedInfo?.muted }),
  },
  {
    id: 'move-to-window',
    icon: 'external',
    title: 'タブを新しいウィンドウへ移動',
    keywords: 'move tab new window detach',
    needsTab: true,
    run: ({ tab }) => chrome.windows.create({ tabId: tab.id }),
  },
  {
    id: 'reload-tab',
    icon: 'reload',
    title: '再読み込み',
    keywords: 'reload refresh',
    needsTab: true,
    run: ({ tab }) => chrome.tabs.reload(tab.id),
  },
  {
    id: 'copy-url',
    icon: 'link',
    title: 'URLをコピー',
    keywords: 'copy url link address',
    needsTab: true,
    run: ({ tab }) => navigator.clipboard.writeText(tab.url ?? ''),
  },
  {
    id: 'copy-markdown',
    icon: 'markdown',
    title: 'Markdownリンクをコピー',
    keywords: 'copy markdown link md',
    needsTab: true,
    run: ({ tab }) => navigator.clipboard.writeText(`[${tab.title ?? ''}](${tab.url ?? ''})`),
  },
  {
    id: 'show-archive',
    icon: 'archive',
    title: 'アーカイブしたタブを表示',
    keywords: 'archive archived auto close tabs jidou tojita',
    view: 'archive',
  },
  {
    id: 'auto-close-off',
    icon: 'timer',
    title: 'タブの自動クローズをオフにする',
    keywords: 'auto close archive tabs off disable jidou',
    when: (ctx) => ctx.autoClose === true,
    run: () => setEnabled(false),
  },
  {
    id: 'auto-close-on',
    icon: 'timer',
    title: 'タブの自動クローズをオンにする',
    keywords: 'auto close archive tabs on enable jidou',
    when: (ctx) => ctx.autoClose === false,
    run: () => setEnabled(true),
  },
  {
    id: 'open-options',
    icon: 'sliders',
    title: 'Yadokariの設定を開く',
    keywords: 'yadokari settings options preferences settei',
    run: () => chrome.runtime.openOptionsPage(),
  },
  { id: 'open-history', icon: 'clock', title: '履歴を開く', keywords: 'history rireki', run: (ctx) => openInternal(ctx, 'chrome://history') },
  { id: 'open-bookmarks', icon: 'bookmark', title: 'ブックマークマネージャを開く', keywords: 'bookmarks manager', run: (ctx) => openInternal(ctx, 'chrome://bookmarks') },
  { id: 'open-downloads', icon: 'download', title: 'ダウンロードを開く', keywords: 'downloads', run: (ctx) => openInternal(ctx, 'chrome://downloads') },
  { id: 'open-extensions', icon: 'blocks', title: '拡張機能を開く', keywords: 'extensions kakuchou', run: (ctx) => openInternal(ctx, 'chrome://extensions') },
  { id: 'open-settings', icon: 'gear', title: 'Chromeの設定を開く', keywords: 'settings preferences settei', run: (ctx) => openInternal(ctx, 'chrome://settings') },
  {
    id: 'open-shortcuts',
    icon: 'keyboard',
    title: '拡張機能のショートカット設定を開く',
    keywords: 'shortcuts keyboard keybinding',
    run: (ctx) => openInternal(ctx, 'chrome://extensions/shortcuts'),
  },
];

function openInternal({ tab }, url) {
  return chrome.tabs.create(tab ? { url, windowId: tab.windowId, index: tab.index + 1 } : { url });
}

/** Commands usable right now; those acting on a tab are hidden when there is none. */
export function availableCommands(ctx) {
  return COMMANDS.filter((c) => (!c.needsTab || ctx.tab) && (!c.when || c.when(ctx)));
}

export function findCommand(id) {
  return COMMANDS.find((c) => c.id === id);
}
