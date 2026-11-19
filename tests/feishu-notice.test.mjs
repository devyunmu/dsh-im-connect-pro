import assert from 'node:assert/strict'
import test from 'node:test'
import * as realSdk from '@larksuiteoapi/node-sdk'
import { createFeishuChannel } from '../lib/channels/feishu.js'
import { accessNotice, evaluateAccess } from '../lib/channels/feishu-access.js'

const baseConfig = {
  groupPolicy: 'mention',
  groupAllowlist: [],
  groupDenylist: [],
  allowBotSender: false,
  groupDeniedNotice: true,
}

function decide({ config = {}, ...overrides } = {}) {
  const input = {
    senderIdType: 'user',
    senderOpenId: 'ou_user',
    chatId: 'oc_group_1',
    isGroup: true,
    isBotMentioned: true,
    ...overrides,
    config: { ...baseConfig, ...config },
  }
  return { input, decision: evaluateAccess(input), notice: accessNotice(input, evaluateAccess(input)) }
}

test('分级话术矩阵：loop 永远静默，off/名单外群被 @ 提示，未 @ 与 denylist 静默', () => {
  const loop = decide({ senderIdType: 'app' })
  assert.equal(loop.decision, 'ignore-loop')
  assert.equal(loop.notice, 'none')
  assert.equal(decide({ isBotMentioned: false }).notice, 'none', 'mention 档未 @ 静默')
  assert.equal(decide({ config: { groupPolicy: 'off' } }).notice, 'group-disabled')
  assert.equal(decide({ config: { groupPolicy: 'off' }, isBotMentioned: false }).notice, 'none', 'off 未 @ 静默')
  assert.equal(decide({
    chatId: 'oc_other',
    config: { groupPolicy: 'allowlist', groupAllowlist: ['oc_allowed'] },
  }).notice, 'group-disabled', 'allowlist 名单外被 @ 提示')
  assert.equal(decide({
    chatId: 'oc_other',
    isBotMentioned: false,
    config: { groupPolicy: 'allowlist', groupAllowlist: ['oc_allowed'] },
  }).notice, 'none', '名单外未 @ 静默')
  assert.equal(decide({
    chatId: 'oc_denied',
    config: { groupDenylist: ['oc_denied'] },
  }).notice, 'none', 'denylist 有意屏蔽，不打扰')
  assert.equal(decide({ isGroup: false, isBotMentioned: false }).notice, 'none', '私聊不新增提示')
  assert.equal(decide({}).decision, 'allow')
  assert.equal(decide({}).notice, 'none')
})

function makeSdk(creates) {
  let dispatcher
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
  return { sdk, onMessage: () => dispatcher?.['im.message.receive_v1'] }
}

async function startChannel(t, config, creates) {
  const handled = []
  const fake = makeSdk(creates)
  const channel = createFeishuChannel('feishu', { appId: 'app', appSecret: 'sec', ...config }, () => {}, async () => fake.sdk)
  t.after(() => channel.stop())
  channel.setMessageHandler(msg => { handled.push(msg) })
  await channel.start()
  const onMessage = fake.onMessage()
  assert.equal(typeof onMessage, 'function')
  const receive = (senderType, overrides = {}) => onMessage({
    sender: { sender_id: { open_id: senderType === 'app' ? 'ou_bot' : 'ou_human' }, sender_type: senderType },
    message: {
      message_id: `om_${senderType}_${Math.random()}`,
      chat_id: 'oc_group_1',
      chat_type: 'group',
      message_type: 'text',
      content: JSON.stringify({ text: 'hi' }),
      mentions: [{ id: { open_id: 'ou_bot' } }],
      ...overrides,
    },
  })
  return { handled, receive }
}

test('接线：群未启用被 @ 回一条提示，同群冷却不重复，loop/未 @ 静默', async t => {
  const creates = []
  const { handled, receive } = await startChannel(t, {
    groupPolicy: 'off',
    groupAllowlist: [],
    groupDenylist: [],
    allowBotSender: false,
    groupDeniedNotice: true,
  }, creates)

  await receive('user')
  assert.equal(handled.length, 0, 'ignore-* 不进 handler')
  assert.equal(creates.length, 1, 'off 群被 @ 回一条提示')
  assert.deepEqual(JSON.parse(creates[0].data.content), { text: '本群未启用该服务' })
  assert.equal(creates[0].data.receive_id, 'oc_group_1')
  assert.equal(creates[0].params.receive_id_type, 'chat_id')

  await receive('user')
  assert.equal(creates.length, 1, '同群 10 分钟冷却内不重复提示')

  await receive('app')
  assert.equal(creates.length, 1, 'loop 永远静默')

  await receive('user', { mentions: [] })
  assert.equal(creates.length, 1, '未 @ 静默')
  assert.equal(handled.length, 0)
})

test('接线：groupDeniedNotice=false 时完全静默', async t => {
  const creates = []
  const { handled, receive } = await startChannel(t, {
    groupPolicy: 'off',
    groupAllowlist: [],
    groupDenylist: [],
    allowBotSender: false,
    groupDeniedNotice: false,
  }, creates)
  await receive('user')
  assert.equal(creates.length, 0, '关闭提示后零出站')
  assert.equal(handled.length, 0)
})

test('接线：allowlist 名单外被 @ 提示，名单内 @ 放行；denylist 静默', async t => {
  const creates = []
  const { handled, receive } = await startChannel(t, {
    groupPolicy: 'allowlist',
    groupAllowlist: ['oc_allowed'],
    groupDenylist: ['oc_denied'],
    allowBotSender: false,
    groupDeniedNotice: true,
  }, creates)

  await receive('user', { chat_id: 'oc_other' })
  assert.equal(creates.length, 1, '名单外被 @ 提示')
  assert.deepEqual(JSON.parse(creates[0].data.content), { text: '本群未启用该服务' })

  await receive('user', { chat_id: 'oc_denied' })
  assert.equal(creates.length, 1, 'denylist 群静默')

  await receive('user', { chat_id: 'oc_allowed' })
  assert.equal(handled.length, 1, '名单内 @ 放行进 handler')
  assert.equal(creates.length, 1, '放行不产生拒绝提示')
})