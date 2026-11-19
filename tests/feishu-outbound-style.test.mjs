import assert from 'node:assert/strict'
import test from 'node:test'
import * as realSdk from '@larksuiteoapi/node-sdk'
import { createFeishuChannel } from '../lib/channels/feishu.js'

function makeSdk() {
  const calls = []
  const sdk = {
    ...realSdk,
    Client: class {
      request = async () => ({ bot: { open_id: 'ou_bot' } })
      im = {
        message: {
          create: async opts => { calls.push(opts) ; return { code: 0, data: { message_id: 'om_new' } } },
          get: async () => ({ code: 0, data: { items: [] } }),
        },
      }
    },
    EventDispatcher: class {
      register() { return this }
    },
    WSClient: class {
      async start() {}
      close() {}
    },
  }
  return { sdk, calls }
}

test('outboundStyle=post 时 send 走 post 富文本容器（与 Hermes 观感一致）', async () => {
  const { sdk, calls } = makeSdk()
  const channel = createFeishuChannel('feishu', { appId: 'app', appSecret: 'sec', outboundStyle: 'post' }, () => {}, async () => sdk)
  await channel.start()
  try {
    await channel.send('oc_chat_1', '一段 **markdown** 文本')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].data.msg_type, 'post')
    const body = JSON.parse(calls[0].data.content)
    const text = body.post.zh_cn.content[0][0].text
    assert.match(text, /markdown/)
  } finally { await channel.stop() }
})

test('默认 outboundStyle=card 保持 Schema 2.0 卡片行为', async () => {
  const { sdk, calls } = makeSdk()
  const channel = createFeishuChannel('feishu', { appId: 'app', appSecret: 'sec' }, () => {}, async () => sdk)
  await channel.start()
  try {
    await channel.send('oc_chat_1', '一段文本')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].data.msg_type, 'interactive')
  } finally { await channel.stop() }
})
