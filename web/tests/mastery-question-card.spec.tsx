import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MasteryQuestionCard } from '@/components/chat/home/MasteryQuestionCard'
import type { MasteryQuestion } from '@/lib/mastery-question'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (text: string) => text }),
}))

const question: MasteryQuestion = {
  questionId: 'question-1',
  prompt: 'Explain the difference between a population and a sample.',
  questionType: 'short_answer',
  objectiveName: 'Population and sample',
  difficulty: 'easy',
  attempt: 1,
  options: [],
  allowFreeText: true,
}

function mount(overrides: Partial<MasteryQuestion> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(true)
  render(
    <MasteryQuestionCard
      question={{ ...question, ...overrides }}
      grade={null}
      answered={false}
      submittedAnswer=""
      onSubmit={onSubmit}
    />
  )
  return onSubmit
}

describe('mastery answer submission', () => {
  it('enables Submit for a typed answer without requiring a choice', async () => {
    const onSubmit = mount()
    const submit = screen.getByRole('button', { name: 'Submit' })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '  A sample is a subset of the population.  ' },
    })
    expect(submit).toBeEnabled()
    fireEvent.click(submit)
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        text: 'A sample is a subset of the population.',
        answers: [{ questionId: 'question-1', text: 'A sample is a subset of the population.' }],
      })
    )
  })

  it('still submits a selected multiple-choice label', async () => {
    const onSubmit = mount({ options: [{ label: 'A', body: 'A subset' }] })
    fireEvent.click(screen.getByRole('button', { name: /A subset/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        text: 'A',
        answers: [{ questionId: 'question-1', text: 'A' }],
      })
    )
  })

  it('submits an explicit free-text alternative to the choices', async () => {
    const onSubmit = mount({ options: [{ label: 'A', body: 'A subset' }] })
    fireEvent.click(screen.getByRole('button', { name: /Answer in my own words/ }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My explanation' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }))
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        text: 'My explanation',
        answers: [{ questionId: 'question-1', text: 'My explanation' }],
      })
    )
  })
})
