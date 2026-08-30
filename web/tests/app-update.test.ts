import assert from 'node:assert/strict'
import test from 'node:test'

import {
  checkAppUpdate,
  fetchAppUpdateJob,
  fetchAppUpdateStatus,
  requestAppUpdate,
  setAppUpdateChecks,
  updateJobIsActive,
} from '../lib/app-update'

const statusPayload = {
  current_version: '1.6.1',
  check_enabled: true,
  checked_at: '2026-08-30T00:00:00Z',
  cached: false,
  check_error: '',
  update_available: true,
  release: {
    version: '1.7.0',
    name: 'DeepTutor 1.7',
    published_at: '2026-08-30T00:00:00Z',
    url: 'https://github.com/HKUDS/DeepTutor/releases/tag/v1.7.0',
    excerpt: 'A stable release.',
    migration_warning: false,
  },
  installation: {
    mode: 'pypi',
    automatic_update: true,
    command: 'pip install -U deeptutor',
    reason: '',
  },
  launcher_managed: true,
  is_admin: true,
  job: null,
} as const

const jobPayload = {
  id: 'job-1',
  status: 'pending',
  current_version: '1.6.1',
  target_version: '1.7.0',
  created_at: '2026-08-30T00:00:00Z',
  started_at: null,
  finished_at: null,
  error: null,
  restart_count: 0,
} as const

test('app update client uses the canonical system routes', async () => {
  const requests: Array<{ path: string; method: string; body?: string }> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    requests.push({
      path: String(input),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : undefined,
    })
    const updateRequest = String(input) === '/api/v1/system/update' && init?.method === 'POST'
    const body = String(input).endsWith('/job') || updateRequest ? jobPayload : statusPayload
    return new Response(JSON.stringify(body), {
      status: updateRequest ? 202 : 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  try {
    assert.equal((await fetchAppUpdateStatus()).current_version, '1.6.1')
    assert.equal((await checkAppUpdate()).release?.version, '1.7.0')
    assert.equal((await setAppUpdateChecks(false)).check_enabled, true)
    assert.equal((await requestAppUpdate()).id, 'job-1')
    assert.equal((await fetchAppUpdateJob())?.id, 'job-1')
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.deepEqual(
    requests.map(({ path, method }) => ({ path, method })),
    [
      { path: '/api/v1/system/update', method: 'GET' },
      { path: '/api/v1/system/update/check', method: 'POST' },
      { path: '/api/v1/system/update/settings', method: 'PUT' },
      { path: '/api/v1/system/update', method: 'POST' },
      { path: '/api/v1/system/update/job', method: 'GET' },
    ]
  )
  assert.equal(requests[2]?.body, JSON.stringify({ enabled: false }))
  assert.equal(requests[3]?.body, JSON.stringify({ confirmation: 'update-and-restart' }))
})

test('app update client preserves FastAPI error details', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ detail: 'Finish the active conversation.' }), {
      status: 409,
      headers: { 'content-type': 'application/json' },
    })

  try {
    await assert.rejects(requestAppUpdate(), /Finish the active conversation/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('only non-terminal jobs remain active', () => {
  for (const status of ['pending', 'handoff', 'running', 'restarting'] as const) {
    assert.equal(updateJobIsActive(status), true)
  }
  assert.equal(updateJobIsActive('succeeded'), false)
  assert.equal(updateJobIsActive('failed'), false)
})
