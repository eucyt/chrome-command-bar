// What the footer of the bar says about the keys. Pure functions.

/**
 * @typedef {object} Hint
 * @property {string[]} keys one entry per keycap, e.g. ['⌥', '↵']
 * @property {string} label what the keys do
 * @property {boolean} [primary] what Enter does
 */

const OPENS_PAGE = new Set(['bookmark', 'history', 'archived', 'url']);

/**
 * The keys that do something to the selected row, Enter first.
 * @param {object} options
 * @param {{type: string, isContext?: boolean} | null} options.row the selected row; type is an item type, 'url', 'search' or 'empty'
 * @param {'all' | 'command' | 'archive'} options.scope what the bar is listing
 * @param {boolean} options.typed whether anything is in the input
 * @param {'newTab' | 'currentTab'} options.openIn where Enter opens a page
 * @param {boolean} options.mac
 * @returns {Hint[]}
 */
export function footerHints({ row, scope, typed, openIn, mac }) {
  const type = row?.type;
  const inCurrent = openIn === 'currentTab';
  const hints = [];

  if (type === 'tab') hints.push({ keys: ['↵'], label: row.isContext ? 'このタブに戻る' : 'タブに切り替え', primary: true });
  else if (type === 'closed') hints.push({ keys: ['↵'], label: '閉じたタブを復元', primary: true });
  else if (type === 'command') hints.push({ keys: ['↵'], label: '実行', primary: true });
  else if (type === 'search') hints.push({ keys: ['↵'], label: 'Web検索', primary: true });
  else if (OPENS_PAGE.has(type)) hints.push({ keys: ['↵'], label: inCurrent ? 'このタブで開く' : '新しいタブで開く', primary: true });

  if (OPENS_PAGE.has(type)) hints.push({ keys: [mac ? '⌥' : 'Alt', '↵'], label: inCurrent ? '新しいタブで開く' : 'このタブで開く' });
  if (type === 'tab' && !row.isContext) hints.push({ keys: [mac ? '⌃' : 'Alt', '⌫'], label: 'タブを閉じる' });
  if (scope === 'all' && typed && type !== 'search') hints.push({ keys: ['⇧', '↵'], label: 'Web検索' });
  hints.push({ keys: ['esc'], label: '閉じる' });
  return hints;
}
