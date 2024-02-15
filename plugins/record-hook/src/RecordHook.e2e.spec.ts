import api from '@flatfile/api'
import {
  createRecords,
  deleteSpace,
  getRecords,
  setupListener,
  setupSimpleWorkbook,
  setupSpace,
} from '@flatfile/utils-testing'
import { FlatfileRecord } from '.'
import { bulkRecordHook, recordHook } from './record.hook.plugin'

jest.setTimeout(30_000)

describe('RecordHook e2e', () => {
  const listener = setupListener()

  // Console spies
  const logSpy = jest.spyOn(global.console, 'log')
  const logErrorSpy = jest.spyOn(global.console, 'error')

  let spaceId: string
  let sheetId: string

  beforeAll(async () => {
    const space = await setupSpace()
    spaceId = space.id
    const workbook = await setupSimpleWorkbook(space.id, [
      { key: 'firstName', type: 'string' },
      { key: 'lastName', type: 'string' },
      { key: 'email', type: 'string' },
      { key: 'age', type: 'number' },
      { key: 'alive', type: 'boolean' },
      {
        key: 'category',
        type: 'enum',
        config: {
          options: [
            {
              value: 'one',
              label: 'One',
            },
            {
              value: 'two',
              label: 'Two',
            },
          ],
        },
      },
    ])
    sheetId = workbook.sheets![0].id
  })

  afterAll(async () => {
    await deleteSpace(spaceId)
  })

  afterEach(async () => {
    listener.reset()
    logSpy.mockReset()
    logErrorSpy.mockReset()
    const records = await getRecords(sheetId)
    if (records.length > 0) {
      const ids = records.map((record) => record.id)
      await api.records.delete(sheetId, { ids })
    }
  })

  describe('recordHook()', () => {
    it('registers a records:* listener to the client', () => {
      const listenerOnSpy = jest.spyOn(listener, 'on')
      const testCallback = (record) => {
        return record
      }
      listener.use(recordHook('my-sheet-slug', testCallback))
      expect(listenerOnSpy).toHaveBeenCalled()
    })

    it('sets null value', async () => {
      listener.use(
        recordHook('test', (record) => {
          record.set('firstName', null)
        })
      )

      await createRecords(sheetId, [{ firstName: 'John' }])
      await listener.waitFor('commit:created')

      const records = await getRecords(sheetId)

      expect(records[0].values['firstName']).toMatchObject({
        value: undefined,
      })
    })

    it('sets primitive values', async () => {
      listener.use(
        recordHook('test', async (record) => {
          await record.set('firstName', 'John')
          await record.set('age', 18)
          await record.set('alive', true)
        })
      )

      await createRecords(sheetId, [{ email: 'john@doe.com' }])
      await listener.waitFor('commit:created')

      const records = await getRecords(sheetId)

      expect(records[0].values['firstName']).toMatchObject({ value: 'John' })
      expect(records[0].values['age']).toMatchObject({ value: 18 })
      expect(records[0].values['alive']).toMatchObject({ value: true })
    })

    it('sets enum value', async () => {
      listener.use(
        recordHook('test', (record) => {
          record.set('category', 'one')
        })
      )

      await createRecords(sheetId, [{ email: 'john@doe.com' }])
      await listener.waitFor('commit:created')

      const records = await getRecords(sheetId)

      expect(records[0].valid).toBeTruthy()
    })

    it('sets invalid enum value', async () => {
      listener.use(
        recordHook('test', (record) => {
          record.set('category', 'three')
        })
      )

      await createRecords(sheetId, [{ email: 'john@doe.com' }])
      await listener.waitFor('commit:created')

      const records = await getRecords(sheetId)

      expect(records[0].valid).toBeFalsy()
    })

    it('commits record message change', async () => {
      // recordHook will add an error to lastName if firstName is present and lastName is not
      listener.use(
        recordHook('test', (record) => {
          if (!record.get('lastName') && record.get('firstName')) {
            record.addError(
              'lastName',
              'lastName is required if firstName is present'
            )
          }
          return record
        })
      )

      // Create a record with only email
      await createRecords(sheetId, [{ email: 'john@doe.com' }])
      await listener.waitFor('commit:created')

      let records = await getRecords(sheetId)
      expect(records[0].values['firstName'].value).toBeUndefined()
      expect(records[0].values['lastName'].value).toBeUndefined()
      expect(records[0].values['lastName'].messages.length).toBe(0)

      // Update the record with a first name, recordHook will add an error to lastName
      await api.records.update(sheetId, [
        { id: records[0].id, values: { firstName: { value: 'John' } } },
      ])
      await listener.waitFor('commit:created', 2)

      records = await getRecords(sheetId)
      expect(records[0].values['firstName'].value).toBeDefined()
      expect(records[0].values['lastName'].value).toBeUndefined()
      expect(records[0].values['lastName'].messages.length).toBe(1)

      // Update the record with a last name, recordHook will remove the error from lastName
      await api.records.update(sheetId, [
        { id: records[0].id, values: { firstName: { value: undefined } } },
      ])
      await listener.waitFor('commit:created', 3)

      records = await getRecords(sheetId)
      expect(records[0].values['firstName'].value).toBeUndefined()
      expect(records[0].values['lastName'].value).toBeUndefined()
      expect(records[0].values['lastName'].messages.length).toBe(0)
    })

    it('noop', async () => {
      listener.use(
        recordHook('test', (_) => null, {
          debug: true,
        })
      )
      await createRecords(sheetId, [{ email: 'john@doe.com' }])

      await listener.waitFor('commit:created')
      expect(logSpy).toHaveBeenCalledWith('No records modified')
    })

    it('sets metadata', async () => {
      listener.use(
        recordHook('test', (record) => record.setMetadata({ test: true }))
      )

      await createRecords(sheetId, [{ email: 'john@doe.com' }])
      await listener.waitFor('commit:created')

      const records = await getRecords(sheetId)

      expect(records[0].metadata).toMatchObject({ test: true })
    })

    it('handler error', async () => {
      listener.use(
        recordHook('test', (_) => {
          throw new Error('oops')
        })
      )

      await createRecords(sheetId, [{ email: 'john@doe.com' }])

      await listener.waitFor('commit:created')
      expect(logErrorSpy).toHaveBeenCalledWith(
        'An error occurred while running the handler: oops'
      )
    })
  })

  describe('bulkRecordHook()', () => {
    it('registers a records:* listener to the client', () => {
      const listenerOnSpy = jest.spyOn(listener, 'on')
      const testCallback = (record: FlatfileRecord[]) => {
        return record
      }
      listener.use(bulkRecordHook('my-sheet-slug', testCallback))
      expect(listenerOnSpy).toHaveBeenCalled()
    })

    it('sets null value', async () => {
      listener.use(
        bulkRecordHook('test', async (records) => {
          for (const record of records) {
            record.set('firstName', null)
          }
        })
      )

      await createRecords(sheetId, [{ firstName: 'John' }])
      await listener.waitFor('commit:created')

      const records = await getRecords(sheetId)

      expect(records[0].values['firstName']).toMatchObject({
        value: undefined,
      })
    })

    it('sets primitive values', async () => {
      listener.use(
        bulkRecordHook('test', async (records) => {
          for (const record of records) {
            await record.set('firstName', 'John')
            await record.set('age', 18)
            await record.set('alive', true)
          }
        })
      )

      await createRecords(sheetId, [{ email: 'john@doe.com' }])
      await listener.waitFor('commit:created')

      const records = await getRecords(sheetId)

      expect(records[0].values['firstName']).toMatchObject({ value: 'John' })
      expect(records[0].values['age']).toMatchObject({ value: 18 })
      expect(records[0].values['alive']).toMatchObject({ value: true })
    })

    it('sets enum value', async () => {
      listener.use(
        bulkRecordHook('test', async (records) => {
          for (const record of records) {
            record.set('category', 'one')
          }
        })
      )

      await createRecords(sheetId, [{ email: 'john@doe.com' }])
      await listener.waitFor('commit:created')

      const records = await getRecords(sheetId)

      expect(records[0].valid).toBeTruthy()
    })

    it('sets invalid enum value', async () => {
      listener.use(
        bulkRecordHook('test', async (records) => {
          for (const record of records) {
            record.set('category', 'three')
          }
        })
      )

      await createRecords(sheetId, [{ email: 'john@doe.com' }])
      await listener.waitFor('commit:created')

      const records = await getRecords(sheetId)

      expect(records[0].valid).toBeFalsy()
    })

    it('commits record message change', async () => {
      // recordHook will add an error to lastName if firstName is present and lastName is not
      listener.use(
        bulkRecordHook('test', async (records) => {
          for (const record of records) {
            if (!record.get('lastName') && record.get('firstName')) {
              record.addError(
                'lastName',
                'lastName is required if firstName is present'
              )
            }
            return record
          }
        })
      )

      // Create a record with only email
      await createRecords(sheetId, [{ email: 'john@doe.com' }])
      await listener.waitFor('commit:created')

      let records = await getRecords(sheetId)
      expect(records[0].values['firstName'].value).toBeUndefined()
      expect(records[0].values['lastName'].value).toBeUndefined()
      expect(records[0].values['lastName'].messages.length).toBe(0)

      // Update the record with a first name, recordHook will add an error to lastName
      await api.records.update(sheetId, [
        { id: records[0].id, values: { firstName: { value: 'John' } } },
      ])
      await listener.waitFor('commit:created', 2)

      records = await getRecords(sheetId)
      expect(records[0].values['firstName'].value).toBeDefined()
      expect(records[0].values['lastName'].value).toBeUndefined()
      expect(records[0].values['lastName'].messages.length).toBe(1)

      // Update the record with a last name, recordHook will remove the error from lastName
      await api.records.update(sheetId, [
        { id: records[0].id, values: { firstName: { value: undefined } } },
      ])
      await listener.waitFor('commit:created', 3)

      records = await getRecords(sheetId)
      expect(records[0].values['firstName'].value).toBeUndefined()
      expect(records[0].values['lastName'].value).toBeUndefined()
      expect(records[0].values['lastName'].messages.length).toBe(0)
    })

    it('noop', async () => {
      listener.use(
        bulkRecordHook('test', (_) => null, {
          debug: true,
        })
      )
      await createRecords(sheetId, [{ email: 'john@doe.com' }])

      await listener.waitFor('commit:created')
      expect(logSpy).toHaveBeenCalledWith('No records modified')
    })

    it('sets metadata', async () => {
      listener.use(
        bulkRecordHook('test', async (records) => {
          for (const record of records) {
            record.setMetadata({ test: true })
          }
        })
      )

      await createRecords(sheetId, [{ email: 'john@doe.com' }])
      await listener.waitFor('commit:created')

      const records = await getRecords(sheetId)

      expect(records[0].metadata).toMatchObject({ test: true })
    })

    it('handler error', async () => {
      listener.use(
        bulkRecordHook('test', async (_) => {
          throw new Error('oops')
        })
      )

      await createRecords(sheetId, [{ email: 'john@doe.com' }])

      await listener.waitFor('commit:created')
      expect(logErrorSpy).toHaveBeenCalledWith(
        'An error occurred while running the handler: oops'
      )
    })
  })
})
