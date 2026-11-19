/**
 * 飞书引用消息回取：把被引用消息的正文还原成可前置到主消息的上下文。
 *
 * 行为与现役垫片（`lib/channels/feishu.js` 的 quoteId 块）逐字节一致：
 * text 取 `body.content.text`，post 取标题 + 各行文本，JSON 解析失败回退
 * 原始 content 前 500 字符；非 text/post 与垫片一致不生成引用正文。
 */

/** 入站消息里可能指向被引用消息的字段；按优先级取第一个非空值。 */
export interface FeishuQuoteMessage {
  parent_id?: string
  upper_message_id?: string
  root_id?: string
}

/** `im.message.get` 返回的单条消息（只声明引用回取用到的字段）。 */
export interface FeishuQuoteItem {
  msg_type?: string
  body?: { content?: string }
  sender?: { id_type?: string; sender_type?: string }
  create_time?: string
}

/** 引用回取成功后的上下文；`quoteText` 为空时调用方不应添加前缀。 */
export interface FeishuQuoteContext {
  quoteText: string
  senderIdType?: string
  createTime?: string
}

/** 引用回取需要的 SDK 缝隙；测试注入伪 SDK，生产注入真实 Client。 */
export interface FeishuQuoteClient {
  im: {
    message: {
      get(payload: { path: { message_id: string } }): Promise<{ data?: { items?: FeishuQuoteItem[] } } | undefined>
    }
  }
}

/** 取引用目标 ID：parent_id > upper_message_id > root_id，空白视为缺失。 */
export function feishuQuoteId(message: FeishuQuoteMessage): string | null {
  const parentId = typeof message.parent_id === 'string' && message.parent_id.trim() ? message.parent_id : undefined
  if (parentId !== undefined) return parentId
  const upperId = typeof message.upper_message_id === 'string' && message.upper_message_id.trim() ? message.upper_message_id : undefined
  if (upperId !== undefined) return upperId
  const rootId = typeof message.root_id === 'string' && message.root_id.trim() ? message.root_id : undefined
  return rootId ?? null
}

/** 与垫片相同：text/post 提取正文，解析失败回退原始 content 前 500 字符。 */
function quoteItemText(item: FeishuQuoteItem): string {
  const raw = item.body?.content ?? ''
  let quoteText = ''
  try {
    const quoteBody = JSON.parse(item.body?.content ?? '{}') as Record<string, any>
    if (item.msg_type === 'text') quoteText = quoteBody.text ?? ''
    else if (item.msg_type === 'post') {
      const post = quoteBody.content ? quoteBody : quoteBody.zh_cn ?? quoteBody.en_us ?? Object.values(quoteBody)[0]
      if (post && Array.isArray(post.content)) {
        if (post.title) quoteText += post.title + '\n'
        for (const row of post.content) for (const entry of row) if (typeof entry.text === 'string') quoteText += entry.text
      }
    }
  } catch {
    quoteText = raw.slice(0, 500)
  }
  return quoteText
}

/** 在 signal 取消/超时时拒绝，避免 SDK 请求悬挂拖住主消息。 */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  const aborted = (): Error => new Error('引用回取已取消或超时', { cause: signal.reason })
  if (signal.aborted) {
    void promise.catch(() => undefined)
    return Promise.reject(aborted())
  }
  return new Promise<T>((resolve, reject) => {
    const cleanup = (): void => signal.removeEventListener('abort', onAbort)
    const onAbort = (): void => { cleanup(); reject(aborted()) }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      value => { cleanup(); resolve(value) },
      error => { cleanup(); reject(error) },
    )
  })
}

/**
 * 回取被引用消息的正文与发送者信息。
 * @param client - 飞书 SDK Client（或测试伪实现）。
 * @param message - 当前入站消息，含 parent_id/upper_message_id/root_id。
 * @param signal - 取消/超时信号。
 * @returns 引用上下文；没有引用目标或被引用消息不存在时返回 null；请求异常向上抛。
 */
export async function fetchQuoteContext(
  client: FeishuQuoteClient,
  message: FeishuQuoteMessage,
  signal: AbortSignal,
): Promise<FeishuQuoteContext | null> {
  const quoteId = feishuQuoteId(message)
  if (!quoteId) return null
  const response = await raceAbort(client.im.message.get({ path: { message_id: quoteId } }), signal)
  const item = response?.data?.items?.[0]
  if (!item) return null
  return {
    quoteText: quoteItemText(item),
    senderIdType: item.sender?.id_type,
    createTime: item.create_time,
  }
}

/**
 * 把引用正文前置到已解析的主消息；回取失败只记日志，返回值保持原消息。
 * 这段包装让 feishu.ts 的钩子保持一行，并保证异常不阻断主消息投递。
 */
export async function prependFeishuQuote<T extends { text: string }>(
  client: FeishuQuoteClient,
  message: FeishuQuoteMessage,
  resolved: T,
  signal: AbortSignal,
  log: (line: string) => void,
  id: string,
): Promise<T> {
  try {
    const quote = await fetchQuoteContext(client, message, signal)
    if (!quote?.quoteText) return resolved
    return { ...resolved, text: `【引用】${quote.quoteText}\n——\n${resolved.text ?? ''}` }
  } catch (error) {
    log(`[${id}] 引用消息回取失败（不影响主消息处理）: ${error instanceof Error ? error.message : String(error)}`)
    return resolved
  }
}