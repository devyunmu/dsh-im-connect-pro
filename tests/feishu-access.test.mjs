import assert from 'node:assert/strict'
import test from 'node:test'
import * as realSdk from '@larksuiteoapi/node-sdk'
import { createFeishuChannel } from '../lib/channels/feishu.js'
import { evaluateAccess, parseFeishuChatList, resolveFeishuAccessConfig } from '../lib/channels/feishu-access.js'

const baseConfig = {
  groupPolicy: 'mention',
  groupAllowlist: [],
  groupDenylist: [],
  allowBotSender: false,
}

function decide({ config = {}, ...overrides } = {}) {
  return evaluateAccess({
    senderIdType: 'user',
    senderOpenId: 'ou_user',
    chatId: 'oc_group_1',
    isGroup: true,
    isBotMentioned: true,
    ...overrides,
    config: { ...baseConfig, ...config },
  })
}

test('① bot 自回声被 @ → ignore-loop（F2 优先于群名单）', () => {
  assert.equal(decide({
    senderIdType: 'app',
    senderOpenId: 'ou_self_bot',
    isBotMentioned: true,
    config: { groupDenylist: ['oc_group_1'] },
  }), 'ignore-loop')
  assert.equal(decide({
    senderIdType: 'app',
    isGroup: false,
    isBotMentioned: false,
  }), 'ignore-loop', 'F2 先于私聊放行')
})

test('② 其他 bot 未 @ → ignore-loop', () => {
  assert.equal(decide({ senderIdType: 'app', senderOpenId: 'ou_other_bot', isBotMentioned: false }), 'ignore-loop')
})

test('③ allowBotSender=true → allow（只关闭回环拦截，仍走群档位）', () => {
  assert.equal(decide({
    senderIdType: 'app',
    senderOpenId: 'ou_other_bot',
    isBotMentioned: true,
    config: { allowBotSender: true },
  }), 'allow')
  assert.equal(decide({
    senderIdType: 'app',
    isGroup: false,
    isBotMentioned: false,
    config: { allowBotSender: true },
  }), 'allow')
})

test('④ 群聊未 @ → ignore-group-policy', () => {
  assert.equal(decide({ isBotMentioned: false }), 'ignore-group-policy')
})

test('⑤ 群聊 @ → allow', () => {
  assert.equal(decide({ isBotMentioned: true }), 'allow')
})

test('⑥ policy=off → ignore-group-policy（即使被 @）', () => {
  assert.equal(decide({ isBotMentioned: true, config: { groupPolicy: 'off' } }), 'ignore-group-policy')
})

test('⑦ allowlist 群 @ → allow', () => {
  assert.equal(decide({
    chatId: 'oc_allowed',
    isBotMentioned: true,
    config: { groupPolicy: 'allowlist', groupAllowlist: ['oc_allowed'] },
  }), 'allow')
  assert.equal(decide({
    chatId: 'oc_allowed',
    isBotMentioned: false,
    config: { groupPolicy: 'allowlist', groupAllowlist: ['oc_allowed'] },
  }), 'ignore-group-policy', '名单群仍要求 @')
})

test('⑧ 非 allowlist 群 → ignore-not-allowed（即使被 @）', () => {
  assert.equal(decide({
    chatId: 'oc_other',
    isBotMentioned: true,
    config: { groupPolicy: 'allowlist', groupAllowlist: ['oc_allowed'] },
  }), 'ignore-not-allowed')
})

test('⑨ denylist 群被 @ → ignore-not-allowed（优先于 allowlist）', () => {
  assert.equal(decide({
    chatId: 'oc_denied',
    isBotMentioned: true,
    config: { groupPolicy: 'allowlist', groupAllowlist: ['oc_denied'], groupDenylist: ['oc_denied'] },
  }), 'ignore-not-allowed')
})

test('⑩ 私聊跳过群档位 → allow（继续走既有白名单逻辑）', () => {
  assert.equal(decide({
    senderOpenId: 'ou_whitelisted',
    chatId: 'oc_p2p_1',
    isGroup: false,
    isBotMentioned: false,
    config: { groupPolicy: 'allowlist', groupAllowlist: ['oc_group_only'] },
  }), 'allow')
})

test('⑪ 私聊白名单外不在本层回归 → allow（既有 engine.access 继续拒绝）', () => {
  assert.equal(decide({
    senderOpenId: 'ou_stranger',
    chatId: 'oc_p2p_2',
    isGroup: false,
    isBotMentioned: false,
  }), 'allow')
})

test('群名单解析与档位归一', () => {
  assert.deepEqual(parseFeishuChatList(' oc_a, oc_b，oc_c; oc_a\noc_d '), ['oc_a', 'oc_b', 'oc_c', 'oc_d'])
  assert.deepEqual(parseFeishuChatList(undefined), [])
  assert.deepEqual(resolveFeishuAccessConfig({
    groupPolicy: 'allowlist',
    groupAllowlist: 'oc_a, oc_b',
    groupDenylist: 'oc_bad',
    allowBotSender: 'true',
  }), { groupPolicy: 'allowlist', groupAllowlist: ['oc_a', 'oc_b'], groupDenylist: ['oc_bad'], allowBotSender: true })
  assert.deepEqual(resolveFeishuAccessConfig({ groupPolicy: 'bogus' }), {
    groupPolicy: 'mention', groupAllowlist: [], groupDenylist: [], allowBotSender: false,
  })
})

test('接线：ignore-* 不调用 handler、零出站；allow 才进 handler', async t => {
  let dispatcher
  const creates = []
  const sdk = {
    ...realSdk,
    Client: class {
      request = async () => ({ bot: { open_id: 'ou_bot' } })
      im = {
        message: {
          create: async opts => { creates.push(opts); return { code: 0 } },
          reply: async () => ({ code: 0 }),
          get: async () => ({ data: { items: [] } }),
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
  const handled = []
  const channel = createFeishuChannel('feishu', {
    appId: 'app',
    appSecret: 'sec',
    groupPolicy: 'mention',
    groupAllowlist: [],
    groupDenylist: ['oc_denied'],
    allowBotSender: false,
  }, () => {}, async () => sdk)
  t.after(() => channel.stop())
  channel.setMessageHandler(msg => { handled.push(msg) })
  await channel.start()
  const onMessage = dispatcher['im.message.receive_v1']
  assert.equal(typeof onMessage, 'function')
  const receive = (senderType, overrides = {}) => onMessage({
    sender: { sender_id: { open_id: senderType === 'app' ? 'ou_bot' : 'ou_human' }, sender_type: senderType },
    message: {
      message_id: `om_${senderType}_${Object.keys(overrides).length}`,
      chat_id: 'oc_group_1',
      chat_type: 'group',
      message_type: 'text',
      content: JSON.stringify({ text: 'hi' }),
      mentions: [{ id: { open_id: 'ou_bot' } }],
      ...overrides,
    },
  })

  await receive('app')
  assert.equal(handled.length, 0, 'bot 回环不得进 handler')
  await receive('user', { mentions: [] })
  assert.equal(handled.length, 0, '未 @ 不得进 handler')
  await receive('user', { chat_id: 'oc_denied' })
  assert.equal(handled.length, 0, 'denylist 群不得进 handler')
  assert.equal(creates.length, 0, 'ignore-* 全程零 im.message.create')

  await receive('user')
  assert.equal(handled.length, 1, 'allow 才进 handler')
  assert.equal(creates.length, 0, 'handler 本身不触发 outbound')
})