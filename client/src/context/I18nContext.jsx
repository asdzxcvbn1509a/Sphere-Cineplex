import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import th from '../i18n/th.json';
import en from '../i18n/en.json';

const dictionaries = { th, en };
const STORAGE_KEY = 'cinebook.lang';

const I18nContext = createContext(null);

const resolve = (dict, path) =>
  path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), dict);

export const I18nProvider = ({ children }) => {
  const [lang, setLang] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'th';
    } catch {
      return 'th';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // โหมดส่วนตัวของเบราว์เซอร์อาจเขียนไม่ได้ — ไม่เป็นไร ใช้ค่า default ต่อได้
    }
    document.documentElement.lang = lang;
  }, [lang]);

  /** แปลข้อความ พร้อมแทนค่าตัวแปรแบบ {{name}} */
  const t = useCallback(
    (key, vars) => {
      const raw = resolve(dictionaries[lang], key) ?? resolve(dictionaries.th, key);
      if (typeof raw !== 'string') return key;
      if (!vars) return raw;
      return raw.replace(/\{\{(\w+)\}\}/g, (_, name) => String(vars[name] ?? ''));
    },
    [lang],
  );

  /** เลือกฟิลด์ตามภาษาสำหรับข้อมูลจาก DB — pick(movie, 'title') → titleTh / titleEn */
  const pick = useCallback(
    (obj, field) => {
      if (!obj) return '';
      const suffix = lang === 'en' ? 'En' : 'Th';
      return obj[`${field}${suffix}`] || obj[`${field}Th`] || '';
    },
    [lang],
  );

  const value = useMemo(
    () => ({
      lang,
      setLang,
      toggleLang: () => setLang((current) => (current === 'th' ? 'en' : 'th')),
      t,
      pick,
    }),
    [lang, t, pick],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = () => {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n ต้องอยู่ภายใน <I18nProvider>');
  return context;
};

export default I18nProvider;
