import assert from 'node:assert/strict'
import test from 'node:test'
import { parseMentionAliasList } from '../lib/channels/feishu-access.js'
import { buildPostContentSegments, injectMentionMarkup } from '../lib/channels/feishu.js'

const ALIASES = { 云小智: 'ou_1', 云小安: 'ou_2' }

test('parseMentionAliasList：中英文逗号/分号/换行分隔，非法条目跳过，同名后者覆盖', () => {
  assert.deepEqual(parseMentionAliasList(' 云小智=ou_1，云小安=ou_2;坏条目,=x,云小智=ou_1b '), {
    云小智: 'ou_1b',
    云小安: 'ou_2',
  })
  assert.deepEqual(parseMentionAliasList(''), {})
  assert.deepEqual(parseMentionAliasList(undefined), {})
  assert.deepEqual(parseMentionAliasList(42), {})
})

test('injectMentionMarkup：text 样式渲染 <at user_id>，markdown 样式渲染 <at id>；未命中保持原文', () => {
  assert.equal(
    injectMentionMarkup('请 @云小智 收货，@云小安 备份', ALIASES, 'text'),
    '请 <at user_id="ou_1"></at> 收货，<at user_id="ou_2"></at> 备份',
  )
  assert.equal(
    injectMentionMarkup('@云小智 反向通了', ALIASES, 'markdown'),
    '<at id="ou_1"></at> 反向通了',
  )
  assert.equal(injectMentionMarkup('@陌生人 不要替换', ALIASES, 'text'), '@陌生人 不要替换')
  // 带别名的长名优先于短名（@云小智 与假设的 @云小 匹配最长者）
  assert.equal(
    injectMentionMarkup('@云小智 hi', { 云小: 'ou_short', 云小智: 'ou_long' }, 'text'),
    '<at user_id="ou_long"></at> hi',
  )
  assert.equal(injectMentionMarkup('无 @ 文本', ALIASES, 'text'), '无 @ 文本')
  assert.equal(injectMentionMarkup('文本', undefined, 'text'), '文本')
})

test('buildPostContentSegments：命中处拆出 at 段，未命中单 text 段', () => {
  assert.deepEqual(buildPostContentSegments('开头 @云小智 结尾', ALIASES), [
    { tag: 'text', text: '开头 ' },
    { tag: 'at', user_id: 'ou_1' },
    { tag: 'text', text: ' 结尾' },
  ])
  assert.deepEqual(buildPostContentSegments('@云小智@云小安', ALIASES), [
    { tag: 'at', user_id: 'ou_1' },
    { tag: 'at', user_id: 'ou_2' },
  ])
  assert.deepEqual(buildPostContentSegments('普通文本', ALIASES), [{ tag: 'text', text: '普通文本' }])
  assert.deepEqual(buildPostContentSegments('', ALIASES), [{ tag: 'text', text: '' }])
})

test('e2e：outboundStyle=post + mentionAliases 时 send 的 post payload 含真实 at 段', async () => {
  const calls = []
  const { createFeishuChannel } = await import('../lib/channels/feishu.js')
  const sdk = await import('@larksuiteoapi/node-sdk')
  const mock = {
    ...sdk,
    Client: class {
      request = async () => ({ bot: { open_id: 'ou_bot' } })
      im = {
        message: {
          create: async opts => { calls.push(opts); return { code: 0, data: { message_id: 'om_m' } } },
          get: async () => ({ code: 0, data: { items: [] } }),
        },
      }
    },
    EventDispatcher: class { register() { return this } },
    WSClient: class { async start() {} close() {} },
  }
  const channel = createFeishuChannel(
    'feishu',
    { appId: 'app', appSecret: 'sec', outboundStyle: 'post', mentionAliases: ALIASES },
    () => {},
    async () => mock,
  )
  await channel.start()
  try {
    await channel.send('oc_chat_1', '@云小智 反向验证')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].data.msg_type, 'post')
    const body = JSON.parse(calls[0].data.content)
    const segments = body.post.zh_cn.content[0]
    assert.deepEqual(segments, [
      { tag: 'at', user_id: 'ou_1' },
      { tag: 'text', text: ' 反向验证' },
    ])
  } finally { await channel.stop() }
})
