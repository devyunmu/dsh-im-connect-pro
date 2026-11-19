import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveFeishuContent } from '../lib/channels/feishu.js'
import { extractPostText, summarizeMergeForward } from '../lib/channels/feishu-rich.js'

const client = { im: { messageResource: { get: async () => ({ getReadableStream: () => undefined, headers: {} }) } } }
const signal = AbortSignal.timeout(1_000)

test('merge_forward 结构压成“发送者: 文本”逐行摘要', async () => {
  const content = JSON.stringify({
    title: '群聊记录',
    message_list: [
      { sender_name: '张三', msg_type: 'text', body: { content: JSON.stringify({ text: '你好' }) } },
      { sender_name: '李四', msg_type: 'text', body: { content: JSON.stringify({ text: '收到' }) } },
    ],
  })
  const summary = summarizeMergeForward(content)
  assert.equal(summary, '张三: 你好\n李四: 收到')

  const resolved = await resolveFeishuContent(client, { message_type: 'merge_forward', content }, signal)
  assert.deepEqual(resolved, { text: '张三: 你好\n李四: 收到', media: [] })
})

test('嵌套 post（含嵌套 content 与国际化结构）', async () => {
  const content = JSON.stringify({
    messages: [
      {
        sender: { name: '王五' },
        msg_type: 'post',
        body: { content: JSON.stringify({ zh_cn: { title: '周报', content: [[{ tag: 'text', text: '第一段' }], [{ tag: 'text', text: '第二段' }]] } }) },
      },
      {
        sender: { sender_id: { open_id: 'ou_nested' } },
        msg_type: 'post',
        body: { content: JSON.stringify({ content: [[{ tag: 'text', text: '外层' }, { content: [[{ text: '更深' }]] }]] }) },
      },
    ],
  })
  assert.equal(summarizeMergeForward(content), '王五: 周报 第一段 第二段\nou_nested: 外层 更深')
  assert.equal(extractPostText({ content: [[{ tag: 'text', text: 'a' }], [{ tag: 'img', image_key: 'k' }]] }), 'a [图片]')
})

test('总摘要截断不超过 2000 字符', async () => {
  const message_list = Array.from({ length: 100 }, (_, index) => ({
    sender_name: `S${index}`,
    msg_type: 'text',
    body: { content: JSON.stringify({ text: 'x'.repeat(100) }) },
  }))
  const summary = summarizeMergeForward(JSON.stringify({ message_list }))
  assert.ok(summary.length <= 2000, `len=${summary.length}`)
  assert.ok(summary.startsWith('S0: '))
  const tiny = summarizeMergeForward(JSON.stringify({ message_list }), { maxChars: 20 })
  assert.ok(tiny.length <= 20)
  const capped = summarizeMergeForward(JSON.stringify({ message_list }), { maxChars: 9999 })
  assert.ok(capped.length <= 2000, '配置上限不能突破 2000 硬顶')
})

test('事件 content 只有容器时用 im.message.get 拉取子消息', async () => {
  const base = { im: { messageResource: client.im.messageResource } }
  const ok = {
    ...base,
    im: {
      ...base.im,
      message: { get: async ({ path }) => {
        assert.equal(path.message_id, 'om_merge')
        return { data: { items: [
          { sender_name: '张三', msg_type: 'text', body: { content: JSON.stringify({ text: '来自接口' }) } },
        ] } }
      } },
    },
  }
  const resolved = await resolveFeishuContent(ok, { message_id: 'om_merge', message_type: 'merge_forward', content: '{}' }, signal)
  assert.equal(resolved.text, '张三: 来自接口')

  const fail = {
    im: {
      messageResource: client.im.messageResource,
      message: { get: async () => { throw new Error('500') } },
    },
  }
  await assert.rejects(
    resolveFeishuContent(fail, { message_id: 'om_merge', message_type: 'merge_forward', content: '{}' }, signal),
    /暂不支持该消息类型/,
  )
})

test('解析失败仍抛原错误，richSummary=false 走原错误', async () => {
  assert.equal(summarizeMergeForward('not-json'), null)
  assert.equal(summarizeMergeForward(JSON.stringify({ foo: 'bar' })), null)
  await assert.rejects(
    resolveFeishuContent(client, { message_type: 'merge_forward', content: 'not-json' }, signal),
    /暂不支持该消息类型/,
  )
  await assert.rejects(
    resolveFeishuContent(client, { message_type: 'merge_forward', content: JSON.stringify({ message_list: [{ msg_type: 'text', body: { content: '{"text":"x"}' } }] }) }, signal, { richSummary: false }),
    /暂不支持该消息类型/,
  )
})