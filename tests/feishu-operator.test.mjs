import assert from 'node:assert/strict'
import test from 'node:test'
import * as realSdk from '@larksuiteoapi/node-sdk'
import { createFeishuChannel } from '../lib/channels/feishu.js'
import { OperatorNameCache, resolveOperatorName } from '../lib/channels/feishu-operator.js'

function fakeClient(names, calls) {
  return {
    contact: {
      user: {
        get: async ({ path }) => {
          calls.push(path.user_id)
          const name = names[path.user_id]
          if (name instanceof Error) throw name
          return name === undefined ? { data: {} } : { data: { user: { name } } }
        },
      },
    },
  }
}

test('命中缓存不调 API', async () => {
  const cache = new OperatorNameCache()
  const calls = []
  const client = fakeClient({ ou_a: 'Alice' }, calls)
  assert.equal(await resolveOperatorName(client, 'ou_a', undefined, cache), 'Alice')
  assert.equal(await resolveOperatorName(client, 'ou_a', undefined, cache), 'Alice')
  assert.deepEqual(calls, ['ou_a'], '第二次必须命中缓存')
})

test('miss 调 API 并缓存', async () => {
  const cache = new OperatorNameCache()
  const calls = []
  const client = fakeClient({ ou_b: 'Bob' }, calls)
  assert.equal(await resolveOperatorName(client, 'ou_b', undefined, cache), 'Bob')
  assert.deepEqual(calls, ['ou_b'])
  assert.equal(cache.get('ou_b'), 'Bob')
  assert.equal(cache.size, 1)
})

test('API 抛错降级为 undefined 且不阻断，下一次仍会重试', async () => {
  const cache = new OperatorNameCache()
  const calls = []
  const client = fakeClient({ ou_err: new Error('contact forbidden') }, calls)
  assert.equal(await resolveOperatorName(client, 'ou_err', undefined, cache), undefined)
  assert.equal(await resolveOperatorName(client, 'ou_err', undefined, cache), undefined)
  assert.deepEqual(calls, ['ou_err', 'ou_err'], '失败不得写入负缓存')
  assert.equal(cache.size, 0)
})

test('LRU 淘汰最久未用项', async () => {
  const cache = new OperatorNameCache({ capacity: 2 })
  const calls = []
  const client = fakeClient({ ou_1: 'One', ou_2: 'Two', ou_3: 'Three' }, calls)
  assert.equal(await resolveOperatorName(client, 'ou_1', undefined, cache), 'One')
  assert.equal(await resolveOperatorName(client, 'ou_2', undefined, cache), 'Two')
  // 刷新 ou_1，使 ou_2 成为最久未用。
  assert.equal(await resolveOperatorName(client, 'ou_1', undefined, cache), 'One')
  assert.equal(await resolveOperatorName(client, 'ou_3', undefined, cache), 'Three')
  assert.deepEqual(calls, ['ou_1', 'ou_2', 'ou_3'])
  assert.equal(cache.get('ou_1'), 'One', '刚命中的 ou_1 必须保留')
  assert.equal(cache.get('ou_2'), undefined, '最久未用的 ou_2 被淘汰')
  assert.equal(await resolveOperatorName(client, 'ou_2', undefined, cache), 'Two')
  assert.deepEqual(calls, ['ou_1', 'ou_2', 'ou_3', 'ou_2'], '淘汰后重新查询')
})

test('TTL 过期后重新查询', async () => {
  let now = 0
  const cache = new OperatorNameCache({ ttlMs: 1_000, now: () => now })
  const calls = []
  const client = fakeClient({ ou_ttl: 'Ttl' }, calls)
  assert.equal(await resolveOperatorName(client, 'ou_ttl', undefined, cache), 'Ttl')
  now = 999
  assert.equal(await resolveOperatorName(client, 'ou_ttl', undefined, cache), 'Ttl')
  now = 1_000
  assert.equal(await resolveOperatorName(client, 'ou_ttl', undefined, cache), 'Ttl')
  assert.deepEqual(calls, ['ou_ttl', 'ou_ttl'], '过期后必须重新调用')
})

test('接线：contact 查询结果注入 handler.username，失败仍投递', async t => {
  const handled = []
  const makeSdk = contactGet => ({
    ...realSdk,
    Client: class {
      request = async () => ({ bot: { open_id: 'ou_bot' } })
      contact = { user: { get: contactGet } }
      im = {
        message: {
          create: async () => ({ code: 0 }),
          reply: async () => ({ code: 0 }),
          get: async () => ({ data: { items: [] } }),
        },
      }
    },
    EventDispatcher: class {
      register(handlers) { this.handlers = handlers; return this }
    },
    WSClient: class {
      async start() {}
      close() {}
    },
  })

  let sdk = makeSdk(async ({ path }) => ({ data: { user: { name: path.user_id === 'ou_op_ok' ? '张三' : undefined } } }))
  let dispatcher
  const channel = createFeishuChannel('feishu', { appId: 'app', appSecret: 'sec' }, () => {}, async () => {
    // 捕获 dispatcher 需要从真实 start 路径拿；用闭包替换 EventDispatcher 实例。
    sdk.EventDispatcher = class { register(handlers) { dispatcher = handlers; return this } }
    return sdk
  })
  t.after(() => channel.stop())
  channel.setMessageHandler(msg => { handled.push(msg) })
  await channel.start()

  const receive = (openId) => dispatcher['im.message.receive_v1']({
    sender: { sender_id: { open_id: openId }, sender_type: 'user' },
    message: {
      message_id: `om_${openId}`,
      chat_id: 'oc_p2p_op',
      chat_type: 'p2p',
      message_type: 'text',
      content: JSON.stringify({ text: 'hi' }),
    },
  })
  await receive('ou_op_ok')
  assert.equal(handled.at(-1).username, '张三')
  assert.equal(handled.at(-1).userId, 'ou_op_ok')

  sdk = makeSdk(async () => { throw new Error('no contact permission') })
  // 重新 start 以换用抛错的 SDK；同一频道实例 stop/start 即可。
  await channel.stop()
  await channel.start()
  await receive('ou_op_err')
  assert.equal(handled.at(-1).username, undefined, 'contact 失败时不得注入展示名')
  assert.equal(handled.at(-1).text, 'hi', '主消息仍须投递')
})