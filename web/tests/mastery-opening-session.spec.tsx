import { act, render, waitFor } from '@testing-library/react'
import { StrictMode, useEffect, useRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatStateAdapterProvider, useChatStateAdapter } from '@/features/chat/ChatStateAdapter'
import { useMasteryStudySession } from '@/hooks/useMasteryStudySession'
import { masteryOpeningMessage } from '@/lib/mastery-mode'
import type { MasteryTopic } from '@/lib/learning-api'

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  fetchTopic: vi.fn(),
  replace: vi.fn(),
  t: (text: string) => text,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace }) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mocks.t }) }))
vi.mock('@/hooks/useMasteryPathActivity', () => ({
  useMasteryPathActivity: () => ({ revision: 0 }),
}))
vi.mock('@/lib/learning-api', () => ({ fetchMasteryTopic: mocks.fetchTopic }))
vi.mock('@/features/chat/transport/UnifiedTurnClient', () => ({
  UnifiedTurnClient: class {
    connected = true
    connect() {}
    disconnect() {}
    setResumeState() {}
    send = mocks.send
  },
}))
function topic(pathId: string, kb: string): MasteryTopic {
  return {
    path_id: pathId,
    sources: [{ kind: 'knowledge_base', available: true, source_id: kb }],
  } as MasteryTopic
}
// Exercise the real route hook, commit ordering, adapter and wire builder.
// This opens in the same passive effect phase as MasteryStudy's opener.
function Opening({ pathId }: { pathId: string }) {
  const { state, sendMessage } = useChatStateAdapter()
  const { topic, sessionLoading, sessionError, sessionMode } = useMasteryStudySession(
    pathId,
    undefined,
    '',
    'outline'
  )
  const sent = useRef('')
  useEffect(() => {
    if (!topic || sessionLoading || sessionError || state.isStreaming || sent.current === pathId)
      return
    const opening = masteryOpeningMessage(sessionMode, mocks.t)
    if (!opening) return
    sendMessage(opening)
    sent.current = pathId
  }, [pathId, topic, sessionLoading, sessionError, sessionMode, state.isStreaming, sendMessage])
  return null
}
beforeEach(() => {
  mocks.fetchTopic.mockReset()
})
describe('mastery outline opening', () => {
  it('waits for the configured draft and sends materials and outline mode together', async () => {
    mocks.fetchTopic.mockResolvedValue(topic('english', 'engl-102'))
    render(
      <StrictMode>
        <ChatStateAdapterProvider>
          <Opening pathId="english" />
        </ChatStateAdapterProvider>
      </StrictMode>
    )
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1))
    expect(mocks.send.mock.calls[0][0]).toMatchObject({
      capability: 'mastery_path',
      workspace_mode: 'mastery_path',
      mastery_path_id: 'english',
      mastery_session_mode: 'outline',
      knowledge_bases: ['engl-102'],
      session_id: null,
    })
  })
  it('does not initialize a switched topic using the previous topic materials', async () => {
    let resolveEnglish!: (value: MasteryTopic) => void
    mocks.fetchTopic.mockImplementation((pathId: string) =>
      pathId === 'statistics'
        ? Promise.resolve(topic('statistics', 'stat-151'))
        : new Promise<MasteryTopic>(resolve => {
            resolveEnglish = resolve
          })
    )
    const tree = (pathId: string) => (
      <ChatStateAdapterProvider>
        <Opening pathId={pathId} />
      </ChatStateAdapterProvider>
    )
    const view = render(tree('statistics'))
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1))
    view.rerender(tree('english'))
    expect(mocks.send).toHaveBeenCalledTimes(1)
    await act(async () => resolveEnglish(topic('english', 'engl-102')))
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(2))
    expect(mocks.send.mock.calls[1][0]).toMatchObject({
      mastery_path_id: 'english',
      knowledge_bases: ['engl-102'],
      mastery_session_mode: 'outline',
    })
  })
})
