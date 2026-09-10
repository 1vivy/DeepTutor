import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { expect, it, vi } from 'vitest'
import { ChatStateAdapterProvider, useChatStateAdapter } from '@/features/chat/ChatStateAdapter'
import type { StreamEvent } from '@/features/chat/model/protocol'
import { hasPendingAskUserInMessages } from '@/lib/ask-user-state'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  send: vi.fn(),
  reply: vi.fn().mockResolvedValue(true),
  onEvent: (_event: unknown) => {},
}))
vi.mock('@/lib/session-api', () => ({ getSession: mocks.getSession }))
vi.mock('@/features/chat/transport/UnifiedTurnClient', () => ({
  UnifiedTurnClient: class {
    connected = true
    constructor(onEvent: (event: StreamEvent) => void) {
      mocks.onEvent = onEvent as typeof mocks.onEvent
    }
    connect() {}
    disconnect() {}
    setResumeState() {}
    send = mocks.send
    sendAwaitingAck = mocks.reply
  },
}))
function LoadedSession() {
  const { state, loadSession, submitUserReply } = useChatStateAdapter()
  useEffect(() => {
    void loadSession('session-1')
  }, [loadSession])
  const pending = hasPendingAskUserInMessages(state.messages, 'turn-1')
  return (
    <>
      <output>{state.masterySessionMode}</output>
      <div>{state.isStreaming ? 'active turn' : 'idle'}</div>
      {pending && (
        <button
          onClick={() =>
            void submitUserReply({
              answers: [{ questionId: 'scope', text: 'Synthetic test answer' }],
            })
          }
        >
          Answer restored question
        </button>
      )}
    </>
  )
}
it('reopens an old paused outline, replays its question and replies on the original turn', async () => {
  mocks.getSession.mockResolvedValue({
    id: 'session-1',
    session_id: 'session-1',
    title: 'Outline',
    status: 'waiting_input',
    updated_at: (Date.now() - 86400000) / 1000,
    preferences: {
      workspace_mode: 'mastery_path',
      capability: 'mastery_path',
      mastery_path_id: 'path-1',
      mastery_session_mode: 'outline',
    },
    active_turns: [{ id: 'turn-1', turn_id: 'turn-1', status: 'waiting_input' }],
    messages: [],
  })
  render(
    <ChatStateAdapterProvider>
      <LoadedSession />
    </ChatStateAdapterProvider>
  )
  await waitFor(() =>
    expect(mocks.send).toHaveBeenCalledWith({
      type: 'subscribe_turn',
      turn_id: 'turn-1',
      after_seq: 0,
    })
  )
  expect(screen.getByText('outline')).toBeInTheDocument()
  expect(screen.getByText('active turn')).toBeInTheDocument()
  await act(async () =>
    mocks.onEvent({
      type: 'tool_result',
      source: 'ask_user',
      stage: 'responding',
      content: '',
      timestamp: 1,
      turn_id: 'turn-1',
      session_id: 'session-1',
      seq: 1,
      metadata: {
        tool_call_id: 'ask-1',
        ask_user: { questions: [{ id: 'scope', prompt: 'What would you like to learn?' }] },
      },
    })
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Answer restored question' }))
  await waitFor(() =>
    expect(mocks.reply).toHaveBeenCalledWith({
      type: 'submit_user_reply',
      turn_id: 'turn-1',
      answers: [{ questionId: 'scope', text: 'Synthetic test answer' }],
    })
  )
})
