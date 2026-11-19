import assert from 'node:assert/strict'
import test from 'node:test'
import * as realSdk from '@larksuiteoapi/node-sdk'
import { createFeishuChannel } from '../lib/channels/feishu.js'
import { fetchQuoteContext, feishuQuoteId } from '../lib/channels/feishu-quote.js'

/**
 * 垫片参考实现：逐字复制现役插件 lib/channels/feishu.js 的 quoteId 块正文
 * （去掉网络 I/O 与日志），用于和正式特性做字节级对照。
 */
function shimQuoteText(quoteItem) {
  let quoteText = ''
  try {
    const quoteBody = JSON.parse(quoteItem.body?.content ?? '{}')
    if (quoteItem.msg_type === 'text') quoteText = quoteBody.text ?? ''
    else if (quoteItem.msg_type === 'post') {
      const post = quoteBody.content ? quoteBody : quoteBody.zh_cn ?? quoteBody.en_us ?? Object.values(quoteBody)[0]
      if (post && Array.isArray(post.content)) {
        if (post.title) quoteText += post.title + '\n'
        for (const row of post.content) for (const item of row) if (typeof item.text === 'string') quoteText += item.text
      }
    }
  } catch { quoteText = (quoteItem.body?.content ?? '').slice(0, 500) }
  return quoteText
}

function makeSdk(get) {
  let dispatcher
  const calls = []
  const sdk = {
    ...realSdk,
    Client: class {
      request = async () => ({ bot: { open_id: 'ou_bot' } })
      im = {
        message: {
          create: async () => ({ code: 0 }),
          reply: async () => ({ code: 0 }),
          get: async payload => { calls.push(payload); return get(payload) },
        },
      }
    },
    EventDispatcher: class {
      register(handlers) { dispatcher = handlers; return this }
    },
    WSClient: class {
      async start() {}
      close() {}
    },
  }
  return { sdk, calls, onMessage: () => dispatcher?.['im.message.receive_v1'] }
}

async function startChannel(t, get) {
  const fake = makeSdk(get)
  const logs = []
  const messages = []
  const channel = createFeishuChannel('feishu', { appId: 'app', appSecret: 'sec' }, line => logs.push(line), async () => fake.sdk)
  t.after(() => channel.stop())
  channel.setMessageHandler(msg => { messages.push(msg) })
  await channel.start()
  const onMessage = fake.onMessage()
  assert.equal(typeof onMessage, 'function', '必须注册 im.message.receive_v1')
  const receive = (message = {}) => onMessage({
    sender: { sender_id: { open_id: 'ou_user' } },
    message: {
      message_id: 'om_main',
      chat_id: 'oc_p2p',
      chat_type: 'p2p',
      message_type: 'text',
      content: JSON.stringify({ text: '主消息' }),
      ...message,
    },
  })
  return { ...fake, channel, logs, messages, receive }
}

test('带 parent_id 回取 text 引用并前置【引用】', async t => {
  const quoteItem = {
    msg_type: 'text',
    body: { content: JSON.stringify({ text: '被引用的正文' }) },
    sender: { id_type: 'open_id', sender_type: 'user' },
    create_time: '1700000000000',
  }
  const harness = await startChannel(t, async () => ({ data: { items: [quoteItem] } }))
  await harness.receive({ parent_id: 'om_quote_1' })

  assert.equal(harness.messages.length, 1)
  assert.equal(harness.messages[0].text, '【引用】被引用的正文\n——\n主消息')
  assert.deepEqual(harness.calls[0], { path: { message_id: 'om_quote_1' } })
  assert.equal(feishuQuoteId({ parent_id: 'om_p', upper_message_id: 'om_u', root_id: 'om_r' }), 'om_p', 'parent_id 优先')
  assert.equal(feishuQuoteId({ upper_message_id: 'om_u', root_id: 'om_r' }), 'om_u', '其次 upper_message_id')
  assert.equal(feishuQuoteId({ root_id: 'om_r' }), 'om_r', '最后 root_id')
  assert.equal(feishuQuoteId({ parent_id: '  ', upper_message_id: '', root_id: '' }), null, '全空返回 null')

  const quote = await fetchQuoteContext(
    { im: { message: { get: async () => ({ data: { items: [quoteItem] } }) } } },
    { parent_id: 'om_quote_1' },
    AbortSignal.timeout(1_000),
  )
  assert.deepEqual(quote, { quoteText: '被引用的正文', senderIdType: 'open_id', createTime: '1700000000000' })
})

test('im.message.get 抛 500 时主消息照常投递并记录日志', async t => {
  const harness = await startChannel(t, async () => {
    throw Object.assign(new Error('Request failed with status code 500'), { response: { status: 500 } })
  })
  await harness.receive({ parent_id: 'om_quote_500' })

  assert.equal(harness.messages.length, 1, '引用回取失败不能吞掉主消息')
  assert.equal(harness.messages[0].text, '主消息')
  assert.ok(
    harness.logs.some(line => line.includes('引用消息回取失败（不影响主消息处理）')),
    '必须只记日志，不向用户抛错',
  )

  await assert.rejects(
    fetchQuoteContext(
      { im: { message: { get: () => new Promise(() => {}) } } },
      { parent_id: 'om_quote_timeout' },
      AbortSignal.timeout(10),
    ),
    /取消或超时/,
    'SDK 请求悬挂必须被 10 秒 signal 截断',
  )
})

test('post 引用按标题 + 行文本拼接', async t => {
  const quoteItem = {
    msg_type: 'post',
    body: { content: JSON.stringify({
      zh_cn: {
        title: '引用标题',
        content: [
          [{ tag: 'text', text: '第一行' }, { tag: 'text', text: '第二行' }],
          [{ tag: 'text', text: '第三行' }],
        ],
      },
    }) },
  }
  const harness = await startChannel(t, async () => ({ data: { items: [quoteItem] } }))
  await harness.receive({ parent_id: 'om_quote_post' })

  assert.equal(harness.messages[0].text, '【引用】引用标题\n第一行第二行第三行\n——\n主消息')
})

test('正式实现与垫片输出字节级等价', async () => {
  const cases = [
    { name: 'text ASCII', item: { msg_type: 'text', body: { content: JSON.stringify({ text: 'hello world' }) } } },
    { name: 'text 多行 CJK/emoji', item: { msg_type: 'text', body: { content: JSON.stringify({ text: '第一行\n第二行 🚀' }) } } },
    { name: 'post zh_cn 标题+行', item: { msg_type: 'post', body: { content: JSON.stringify({
      zh_cn: { title: '标题', content: [[{ text: '甲' }, { text: '乙' }], [{ text: '丙' }]] },
    }) } } },
    { name: 'post 顶层 title/content', item: { msg_type: 'post', body: { content: JSON.stringify({
      title: 'Top', content: [[{ text: 'one' }], [{ text: 'two' }]],
    }) } } },
    { name: 'post en_us', item: { msg_type: 'post', body: { content: JSON.stringify({
      en_us: { title: 'English', content: [[{ text: 'row' }]] },
    }) } } },
    { name: 'post 无标题', item: { msg_type: 'post', body: { content: JSON.stringify({
      zh_cn: { content: [[{ text: 'only' }]] },
    }) } } },
    { name: '非法 JSON 回退前 500 字符', item: { msg_type: 'text', body: { content: '不是 JSON 的原始内容' } } },
    { name: '超长非法 JSON 截断 500', item: { msg_type: 'text', body: { content: '{' + 'x'.repeat(800) } } },
    { name: 'text 缺 body', item: { msg_type: 'text' } },
    { name: '非 text/post 与垫片一致不产出', item: { msg_type: 'image', body: { content: JSON.stringify({ image_key: 'img' }) } } },
  ]

  for (const { name, item } of cases) {
    const expectedQuote = shimQuoteText(item)
    const quote = await fetchQuoteContext(
      { im: { message: { get: async () => ({ data: { items: [item] } }) } } },
      { parent_id: 'om_quote_eq' },
      AbortSignal.timeout(1_000),
    )
    assert.ok(Buffer.from(quote?.quoteText ?? '', 'utf8').equals(Buffer.from(expectedQuote, 'utf8')), `${name}: quoteText 字节不等`)
    const actualText = quote?.quoteText ? `【引用】${quote.quoteText}\n——\n主消息` : '主消息'
    const expectedText = expectedQuote ? `【引用】${expectedQuote}\n——\n主消息` : '主消息'
    assert.ok(Buffer.from(actualText, 'utf8').equals(Buffer.from(expectedText, 'utf8')), `${name}: 最终投递文本字节不等`)
  }
})