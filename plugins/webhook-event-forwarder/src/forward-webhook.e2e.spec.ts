import type { FlatfileEvent } from '@flatfile/listener'
import {
  createRecords,
  deleteSpace,
  setupListener,
  setupSimpleWorkbook,
  setupSpace,
} from '@flatfile/utils-testing'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from 'bun:test'
import fetchMock from 'fetch-mock'
import { webhookEventForward } from '.'

describe('forward-webhook() e2e', () => {
  const listener = setupListener()

  let spaceId
  let workbookId
  let sheetId

  beforeAll(async () => {
    const space = await setupSpace()
    spaceId = space.id
    const workbook = await setupSimpleWorkbook(space.id, [
      'name',
      'email',
      'notes',
    ])
    workbookId = workbook.id
    sheetId = workbook.sheets![0].id
  })

  afterAll(async () => {
    await deleteSpace(spaceId)
  })

  afterEach(() => {
    fetchMock.restore()
  })

  let callback
  beforeEach(async () => {
    callback = mock((data: any, event: FlatfileEvent) => {
      return { topic: event.topic, data }
    })
    listener.use(webhookEventForward('example.com', callback))
  })

  afterEach(() => {
    listener.reset()
  })

  it('should pass event', async () => {
    fetchMock.mock('example.com', {
      body: JSON.stringify({
        hello: 'Flatfile',
      }),
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })

    await createRecords(sheetId, [{ name: 'John' }])
    await listener.waitFor('commit:created')

    const callbackReturnValue = callback.mock.results.filter(
      (result) => result.value.topic === 'commit:created'
    )
    expect(callbackReturnValue[0].value).toEqual(
      expect.objectContaining({
        topic: 'commit:created',
        data: {
          hello: 'Flatfile',
        },
      })
    )
  })

  it('should error', async () => {
    fetchMock.mock('example.com', {
      body: JSON.stringify({}),
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })

    await createRecords(sheetId, [{ name: 'Jane' }])
    await listener.waitFor('commit:created')

    const callbackReturnValue = callback.mock.results.filter(
      (result) => result.value.topic === 'commit:created'
    )
    expect(callbackReturnValue[0].value).toEqual(
      expect.objectContaining({
        topic: 'commit:created',
        data: {
          data: 'Error: Error forwarding webhook',
          error: true,
          message: 'Error received, please try again',
        },
      })
    )
  })
})
