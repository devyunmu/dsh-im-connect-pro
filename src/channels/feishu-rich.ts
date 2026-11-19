/**
 * 飞书合并转发 / 嵌套富文本摘要。
 *
 * merge_forward 的 content 可能是 `{ title, message_list }`、`{ messages }`、
 * `{ items }` 或直接数组；每条子消息再按 text/post/merge_forward 展开。
 * 输出每行 `发送者: 文本摘要`，总长度不超过 2000 字符（可配置上限，硬顶 2000）。
 * 任何结构解析失败返回 null，由 resolveFeishuContent 维持原错误。
 */

const DEFAULT_MAX_CHARS = 2000
const MAX_NESTING = 4

type AnyRecord = Record<string, any>

function safeParse(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function asRecord(value: unknown): AnyRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as AnyRecord
    : undefined
}

/** 把 post 的任意国际化/嵌套结构摊平成一行文本。 */
export function extractPostText(content: unknown, depth = 0): string {
  if (depth > MAX_NESTING) return ''
  const parsed = safeParse(content)
  if (Array.isArray(parsed)) return rowsText(parsed, depth)
  const record = asRecord(parsed)
  if (!record) return typeof content === 'string' ? content : ''
  if (Array.isArray(record.content)) {
    const title = typeof record.title === 'string' ? record.title.trim() : ''
    const text = rowsText(record.content, depth)
    return [title, text].filter(Boolean).join(' ')
  }
  for (const key of ['zh_cn', 'en_us', 'ja_jp', 'zh_hk', 'zh_tw']) {
    if (record[key] !== undefined) return extractPostText(record[key], depth + 1)
  }
  if (record.body !== undefined) return extractPostText(record.body, depth + 1)
  if (record.content !== undefined) return extractPostText(record.content, depth + 1)
  return ''
}

function rowsText(rows: unknown[], depth: number): string {
  const parts: string[] = []
  for (const row of rows) {
    if (!Array.isArray(row)) continue
    for (const cell of row) {
      const record = asRecord(cell)
      if (!record) {
        if (typeof cell === 'string' && cell.trim()) parts.push(cell.trim())
        continue
      }
      if (typeof record.text === 'string' && record.text.trim()) {
        parts.push(record.text.trim())
        continue
      }
      if (record.tag === 'img') { parts.push('[图片]'); continue }
      if (record.tag === 'media') { parts.push('[视频]'); continue }
      if (record.tag === 'file') { parts.push('[文件]'); continue }
      if (record.content !== undefined) {
        const nested = extractPostText(record.content, depth + 1)
        if (nested) parts.push(nested)
      }
    }
  }
  return parts.join(' ')
}

function senderName(item: AnyRecord): string {
  const sender = asRecord(item.sender)
  const candidates = [
    item.sender_name,
    sender?.name,
    sender?.sender_name,
    sender?.open_id,
    sender?.id,
    asRecord(sender?.sender_id)?.open_id,
  ]
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return '未知发送者'
}

function itemText(item: AnyRecord, depth: number): string {
  if (depth > MAX_NESTING) return '[嵌套过深]'
  if (typeof item.text === 'string' && item.text.trim()) return item.text.trim()
  const type = String(item.msg_type ?? item.message_type ?? '')
  const body = asRecord(item.body)
  const raw = body?.content ?? item.content
  if (type === 'text') {
    const parsed = asRecord(safeParse(raw))
    if (parsed && typeof parsed.text === 'string' && parsed.text.trim()) return parsed.text.trim()
    return typeof raw === 'string' && raw.trim() ? raw.trim() : ''
  }
  if (type === 'post') return extractPostText(raw ?? item.body ?? item, depth + 1)
  if (type === 'merge_forward') {
    const nested = summarizeMergeForward(raw ?? item, { maxChars: DEFAULT_MAX_CHARS })
    return nested ? nested.replace(/\n+/g, ' / ') : '[合并转发]'
  }
  if (type === 'image') return '[图片]'
  if (type === 'file') return '[文件]'
  if (type === 'audio') return '[语音]'
  if (type === 'media' || type === 'video_chat') return '[视频]'
  if (type === 'sticker') return '[表情]'
  if (type === 'interactive' || type === 'card') return '[卡片]'
  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  return type ? `[${type}]` : '[空消息]'
}

function messageList(content: unknown): AnyRecord[] | undefined {
  const parsed = safeParse(content)
  if (Array.isArray(parsed)) return parsed.filter((item) => asRecord(item) !== undefined) as AnyRecord[]
  const root = asRecord(parsed)
  if (!root) return undefined
  const candidates = [root.message_list, root.messages, root.items, asRecord(root.data)?.items]
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.filter((item) => asRecord(item) !== undefined) as AnyRecord[]
  }
  return undefined
}

/**
 * 把一条 merge_forward content 压成可读摘要。
 * @param content - 事件里的 content 字符串或已解析对象。
 * @param options.maxChars - 总长度上限，默认 2000；超过 2000 按 2000 硬顶。
 * @returns 摘要文本；无法识别结构时返回 null。
 */
export function summarizeMergeForward(content: unknown, options: { maxChars?: number } = {}): string | null {
  const items = messageList(content)
  if (items === undefined || items.length === 0) return null
  const maxChars = Math.max(1, Math.min(Math.floor(options.maxChars ?? DEFAULT_MAX_CHARS), DEFAULT_MAX_CHARS))
  const lines: string[] = []
  let length = 0
  for (const item of items) {
    const text = itemText(item, 0).replace(/\s+/g, ' ').trim() || '[空消息]'
    const line = `${senderName(item)}: ${text}`
    const prefix = lines.length === 0 ? 0 : 1
    if (length + prefix + line.length > maxChars) {
      const remaining = maxChars - length - prefix
      if (remaining > 0) lines.push(line.slice(0, remaining))
      break
    }
    lines.push(line)
    length += prefix + line.length
  }
  const summary = lines.join('\n').slice(0, maxChars)
  return summary || null
}