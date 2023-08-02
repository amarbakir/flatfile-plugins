import { parseBuffer } from './parser'
import { Extractor } from '@flatfile/util-extractor'

export const ExcelExtractor = (options?: { rawNumbers?: boolean }) => {
  return Extractor(/\.(xlsx?|xlsm|xlsb|xltx?|xltm)$/i, parseBuffer, options)
}

export const xlmxExtractorPlugin = ExcelExtractor
