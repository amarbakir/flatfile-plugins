import { FlatfileClient } from '@flatfile/api'
import type { TPrimitive } from '@flatfile/hooks'
import type { FlatfileEvent, FlatfileListener } from '@flatfile/listener'
import type { FlatfileRecord } from '@flatfile/plugin-record-hook'
import { bulkRecordHookPlugin } from '@flatfile/plugin-record-hook'
import { logInfo } from '@flatfile/util-common'

const api = new FlatfileClient()

/**
 * Autocast plugin for Flatfile.
 * Automatically casts field values to their specified types based on the sheet configuration.
 *
 * @param sheetSlug - The slug of the sheet to apply the autocast plugin to.
 * @param fieldFilters - Optional array of field keys to filter the fields to be casted.
 * @param options - Optional options for the bulkRecordHookPlugin.
 * @returns A function that takes a FlatfileListener and applies the autocast plugin to it.
 */
export function autocast(
  sheetSlug: string,
  fieldFilters?: string[],
  options?: {
    chunkSize?: number
    parallel?: number
    debug?: boolean
  }
) {
  return (listener: FlatfileListener) => {
    listener.use(
      bulkRecordHookPlugin(
        sheetSlug,
        async (records: FlatfileRecord[], event: FlatfileEvent) => {
          const sheetId = event.context.sheetId
          const sheet = await api.sheets.get(sheetId)
          if (!sheet) {
            logInfo('@flatfile/plugin-autocast', 'Failed to fetch sheet')
            return
          }

          // Filter the fields to be casted based on the fieldFilters or field type
          const castableFields = sheet.data.config.fields.filter((field) =>
            fieldFilters
              ? fieldFilters.includes(field.key)
              : field.type !== 'string'
          )

          records.forEach((record) => {
            castableFields.forEach((field) => {
              const originalValue = record.get(field.key)
              const caster = CASTING_FUNCTIONS[field.type]

              // Check if the value exists, can be casted, and is not already of the target type
              if (
                originalValue &&
                caster &&
                typeof originalValue !== field.type
              ) {
                try {
                  record.computeIfPresent(field.key, caster)
                } catch (e) {
                  record.addError(
                    field.key,
                    e.message || 'Failed to cast value'
                  )
                }
              }
            })
          })
        },
        options
      )
    )
  }
}

// Object containing casting functions for each supported field type
const CASTING_FUNCTIONS: {
  [key: string]: (value: TPrimitive) => TPrimitive
} = {
  string: castString,
  number: castNumber,
  boolean: castBoolean,
  date: castDate,
}

/**
 * Casts a value to a string.
 *
 * @param value - The value to be casted.
 * @returns The casted string value.
 * @throws An error if the value cannot be casted to a string.
 */
export function castString(value: TPrimitive): TPrimitive {
  if (typeof value === 'string') {
    return value
  } else if (typeof value === 'number') {
    return value.toString()
  } else if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }
  throw new Error(`Failed to cast '${value}' to 'string'`)
}

/**
 * Casts a value to a number.
 *
 * @param value - The value to be casted.
 * @returns The casted number value.
 * @throws An error if the value cannot be casted to a number.
 */
export function castNumber(value: TPrimitive): TPrimitive {
  if (typeof value === 'number') {
    return value
  } else if (typeof value === 'string') {
    const strippedValue = value.replace(/,/g, '')
    if (!isNaN(Number(strippedValue))) {
      const num = Number(strippedValue)
      if (isFinite(num)) {
        return num
      }
    }
  }
  throw new Error('Invalid number')
}

// Array of truthy values for boolean casting
export const TRUTHY_VALUES = ['1', 'yes', 'true', 'on', 't', 'y', 1]

// Array of falsy values for boolean casting
export const FALSY_VALUES = ['-1', '0', 'no', 'false', 'off', 'f', 'n', 0, -1]

/**
 * Casts a value to a boolean.
 *
 * @param value - The value to be casted.
 * @returns The casted boolean value.
 * @throws An error if the value cannot be casted to a boolean.
 */
export function castBoolean(value: TPrimitive): TPrimitive {
  if (typeof value === 'boolean') {
    return value
  } else if (typeof value === 'string' || typeof value === 'number') {
    if (value === '') {
      return null
    }
    const normValue = typeof value === 'string' ? value.toLowerCase() : value
    if (TRUTHY_VALUES.includes(normValue)) {
      return true
    }
    if (FALSY_VALUES.includes(normValue)) {
      return false
    }
  }
  throw new Error('Invalid boolean')
}

/**
 * Casts a value to a date string.
 *
 * @param value - The value to be casted.
 * @returns The casted date string in UTC format.
 * @throws An error if the value cannot be casted to a date.
 */
export function castDate(value: TPrimitive): TPrimitive {
  // Check if value is a number and if so use the numeric value instead of a string
  const numericTimestamp = Number(value)
  let finalValue = !isNaN(numericTimestamp) ? numericTimestamp : value

  if (typeof finalValue === 'string' || typeof finalValue === 'number') {
    const date = new Date(finalValue)
    if (!isNaN(date.getTime())) {
      return date.toUTCString()
    }
  }
  throw new Error('Invalid date')
}
