/**
 * Both dictionaries ship in the card resource so the picker can register translated
 * names synchronously. Each lookup can fall back to English if a translation is missing.
 */
import rosetta from 'rosetta'

import en from './en.json'
import ru from './ru.json'

const dictionaries = { en, ru }
type Language = keyof typeof dictionaries
type MessageKey<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${MessageKey<T[K]>}`
}[keyof T & string]

export const cwPreferredLanguage = (
  preferences: readonly string[],
): { language: Language; locale: string } => {
  for (const locale of preferences) {
    const language = locale.split('-')[0].toLowerCase()
    if (language === 'ru' || language === 'en') return { language, locale }
  }
  return { language: 'en', locale: 'en-US' }
}

const browser = typeof window === 'undefined' ? undefined : window.navigator
const preferences = browser?.languages?.length ? browser.languages : [browser?.language ?? '']
const { language, locale } = cwPreferredLanguage(preferences)
export const cwLanguage = language
export const cwBrowserLocale = browser ? locale : undefined

const messages = rosetta<typeof en>(dictionaries)

export const t = (key: MessageKey<typeof en>, params?: Record<string, string | number>): string =>
  messages.t(key, params, cwLanguage) || messages.t(key, params, 'en')
