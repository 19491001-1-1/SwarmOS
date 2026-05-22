import { useState, useEffect, useCallback } from 'react';

type Locale = 'en' | 'zh';

const dictionaries: Record<Locale, Record<string, string>> = {
  en: {
    'nav.workspace': 'Workspace',
    'nav.search': 'Search',
    'nav.tasks': 'Tasks',
    'nav.knowledge': 'Knowledge',
    'nav.channels': 'Channels',
    'nav.agents': 'Agents',
    'nav.machines': 'Machines',
    'composer.placeholder': 'Message #{channel}',
    'composer.send': 'Send',
    'message.createTask': 'Create task',
    'message.planGoal': 'Plan goal',
    'message.replyInThread': 'Reply in thread',
    'message.copy': 'Copy',
    'thread.list': 'Threads',
    'thread.empty': 'No threads yet',
    'thread.title': 'Thread',
    'thread.close': 'Close',
    'thread.replyPlaceholder': 'Reply in thread',
    'thread.replies': '{count} replies',
    'presence.working': 'Working',
    'presence.thinking': 'Thinking',
    'presence.starting': 'Starting',
    'presence.idle': 'Idle',
    'presence.online': 'Online',
    'presence.error': 'Error',
    'presence.offline': 'Offline',
    'presence.you': 'You',
    'agent.autoStartOn': 'Auto-start on',
    'locale.switch': '中',
  },
  zh: {
    'nav.workspace': '工作区',
    'nav.search': '搜索',
    'nav.tasks': '任务',
    'nav.knowledge': '知识库',
    'nav.channels': '频道',
    'nav.agents': '成员 / Agent',
    'nav.machines': '机器',
    'composer.placeholder': '发消息到 #{channel}',
    'composer.send': '发送',
    'message.createTask': '转任务',
    'message.planGoal': '规划目标',
    'message.replyInThread': '回复 Thread',
    'message.copy': '复制',
    'thread.list': 'Threads',
    'thread.empty': '暂无 Thread',
    'thread.title': 'Thread',
    'thread.close': '关闭',
    'thread.replyPlaceholder': '回复 Thread',
    'thread.replies': '{count} 条回复',
    'presence.working': '工作中',
    'presence.thinking': '思考中',
    'presence.starting': '启动中',
    'presence.idle': '空闲',
    'presence.online': '在线',
    'presence.error': '异常',
    'presence.offline': '离线',
    'presence.you': '你',
    'agent.autoStartOn': '自动启动已开启',
    'locale.switch': 'EN',
  },
};

const STORAGE_KEY = 'crewden_locale';

function loadLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'zh') return stored;
  } catch { /* localStorage unavailable */ }
  return 'en';
}

let currentLocale: Locale = loadLocale();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

export function getLocale(): Locale {
  return currentLocale;
}

export function setLocale(locale: Locale) {
  if (locale === currentLocale) return;
  currentLocale = locale;
  try { localStorage.setItem(STORAGE_KEY, locale); } catch { /* ignore */ }
  notify();
}

export function useLocale() {
  const [locale, setState] = useState<Locale>(currentLocale);
  useEffect(() => {
    const handler = () => setState(currentLocale);
    listeners.add(handler);
    return () => { listeners.delete(handler); };
  }, []);
  const toggle = useCallback(() => {
    setLocale(currentLocale === 'en' ? 'zh' : 'en');
  }, []);
  return { locale, toggle };
}

type Key = keyof typeof dictionaries.en;

export function t(key: Key, values: Record<string, string | number> = {}): string {
  let text = dictionaries[currentLocale][key] ?? dictionaries.en[key] ?? key;
  for (const [name, value] of Object.entries(values)) {
    text = text.split(`{${name}}`).join(String(value));
  }
  return text;
}
