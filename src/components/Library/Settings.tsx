import { useState, useEffect } from 'react';
import { hasApiKey, setApiKey, getReadingProfile, setReadingProfile } from '../../services/ai';
import { refreshProfile, getProfile } from '../../services/personality';
import { useTheme } from '../../contexts/ThemeContext';
import type { Theme, Language } from '../../contexts/ThemeContext';
import { t } from '../../i18n/translations';

interface Props {
  onClose: () => void;
}

const LANGUAGES: { code: Language; label: string; flag: string }[] = [
  { code: 'zh', label: '中文', flag: '🇨🇳' },
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
];

export default function Settings({ onClose }: Props) {
  const { theme, setTheme, language, setLanguage } = useTheme();
  const [key, setKey] = useState(localStorage.getItem('claude-api-key') || '');
  const [openaiKey, setOpenaiKey] = useState(localStorage.getItem('openai-api-key') || '');
  const profile = getReadingProfile();
  const [interests, setInterests] = useState(profile.interests);
  const [goal, setGoal] = useState(profile.goal);
  const [saved, setSaved] = useState(false);
  const [profileLastUpdated, setProfileLastUpdated] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const [showClaudeKey, setShowClaudeKey] = useState(false);
  const [showOpenAIKey, setShowOpenAIKey] = useState(false);

  useEffect(() => {
    getProfile().then(p => {
      if (p) setProfileLastUpdated(p.lastUpdated);
    });
  }, []);

  const handleSave = () => {
    setApiKey(key);
    localStorage.setItem('openai-api-key', openaiKey);
    setReadingProfile(interests, goal);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleRefreshProfile = async () => {
    setRefreshing(true);
    setRefreshError('');
    try {
      const updated = await refreshProfile();
      setProfileLastUpdated(updated.lastUpdated);
    } catch (e) {
      setRefreshError(e instanceof Error ? e.message : 'Failed to refresh profile');
    } finally {
      setRefreshing(false);
    }
  };

  const formatLastUpdated = (ts: number) => new Date(ts).toLocaleString('zh-CN');

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-slate-800 border border-slate-700/60 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/60">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <h2 className="text-base font-semibold text-white">{t(language, 'settingsTitle')}</h2>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center text-slate-500 hover:text-white hover:bg-slate-700 rounded-lg transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto max-h-[calc(100vh-200px)]">

          {/* ── Appearance ─────────────────────────────────── */}
          <div>
            <p className="text-xs font-medium text-slate-400 mb-3 uppercase tracking-wide">
              {t(language, 'appearance')}
            </p>

            {/* Theme toggle */}
            <div className="mb-4">
              <label className="block text-xs text-slate-500 mb-2">{t(language, 'theme')}</label>
              <div className="flex gap-2">
                <ThemeOptionButton
                  active={theme === 'dark'}
                  onClick={() => setTheme('dark' as Theme)}
                  icon={
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                    </svg>
                  }
                  label={t(language, 'darkTheme')}
                  activeColor="bg-indigo-600/20 border-indigo-500/50 text-indigo-300"
                />
                <ThemeOptionButton
                  active={theme === 'light'}
                  onClick={() => setTheme('light' as Theme)}
                  icon={
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                  }
                  label={t(language, 'lightTheme')}
                  activeColor="bg-amber-500/20 border-amber-400/50 text-amber-300"
                />
              </div>
            </div>

            {/* Language switcher */}
            <div>
              <label className="block text-xs text-slate-500 mb-2">{t(language, 'language')}</label>
              <div className="flex flex-wrap gap-2">
                {LANGUAGES.map(({ code, label, flag }) => (
                  <button
                    key={code}
                    onClick={() => setLanguage(code)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-150 ${
                      language === code
                        ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-300'
                        : 'bg-slate-900/60 border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600'
                    }`}
                  >
                    <span>{flag}</span>
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-slate-700/60" />

          {/* Claude API Key */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">
              {t(language, 'claudeApiKey')}
            </label>
            <div className="relative">
              <input
                type={showClaudeKey ? 'text' : 'password'}
                value={key}
                onChange={e => setKey(e.target.value)}
                placeholder="sk-ant-..."
                className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 transition-colors pr-10"
              />
              <button
                type="button"
                onClick={() => setShowClaudeKey(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
              >
                <EyeIcon open={showClaudeKey} />
              </button>
            </div>
            <p className="text-xs mt-1.5">
              {hasApiKey()
                ? <span className="text-emerald-500 flex items-center gap-1"><span className="w-1.5 h-1.5 bg-emerald-500 rounded-full inline-block" />{t(language, 'apiKeyConfigured')}</span>
                : <span className="text-slate-500">{t(language, 'apiKeyRequired')}</span>
              }
            </p>
          </div>

          {/* OpenAI API Key */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">
              {t(language, 'openaiApiKey')} <span className="text-slate-600 normal-case">{t(language, 'apiKeyOptional')}</span>
            </label>
            <div className="relative">
              <input
                type={showOpenAIKey ? 'text' : 'password'}
                value={openaiKey}
                onChange={e => setOpenaiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 transition-colors pr-10"
              />
              <button
                type="button"
                onClick={() => setShowOpenAIKey(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
              >
                <EyeIcon open={showOpenAIKey} />
              </button>
            </div>
            <p className="text-xs text-slate-600 mt-1.5">{t(language, 'openaiKeyHint')}</p>
          </div>

          {/* Divider */}
          <div className="border-t border-slate-700/60" />

          {/* Reading Profile */}
          <div>
            <p className="text-xs font-medium text-slate-400 mb-3 uppercase tracking-wide">
              {t(language, 'readingPrefs')}
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">{t(language, 'interests')}</label>
                <input
                  type="text"
                  value={interests}
                  onChange={e => setInterests(e.target.value)}
                  placeholder={t(language, 'interestsPlaceholder')}
                  className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">{t(language, 'readingGoal')}</label>
                <input
                  type="text"
                  value={goal}
                  onChange={e => setGoal(e.target.value)}
                  placeholder={t(language, 'goalPlaceholder')}
                  className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>
              <p className="text-xs text-slate-600">{t(language, 'aiHint')}</p>
            </div>
          </div>

          {/* Personality Profile Section */}
          <div className="p-4 bg-slate-900/60 rounded-xl border border-slate-700/60">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-sm text-slate-300 font-medium">{t(language, 'personalProfile')}</p>
                {profileLastUpdated ? (
                  <p className="text-xs text-slate-600 mt-0.5">
                    {t(language, 'lastUpdated')}{formatLastUpdated(profileLastUpdated)}
                  </p>
                ) : (
                  <p className="text-xs text-slate-600 mt-0.5">{t(language, 'noProfile')}</p>
                )}
              </div>
              <button
                onClick={handleRefreshProfile}
                disabled={refreshing}
                className="px-3 py-1.5 bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
              >
                {refreshing ? (
                  <>
                    <div className="w-3 h-3 border border-white/50 border-t-white rounded-full animate-spin" />
                    {t(language, 'refreshing')}
                  </>
                ) : t(language, 'refreshProfile')}
              </button>
            </div>
            {refreshError && (
              <p className="text-xs text-rose-400 mt-2 bg-rose-500/10 border border-rose-500/20 rounded-lg px-2.5 py-1.5">{refreshError}</p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 px-6 py-4 border-t border-slate-700/60">
          <button
            onClick={handleSave}
            className={`flex-1 py-2.5 text-sm font-medium rounded-xl transition-all ${
              saved ? 'bg-emerald-600 text-white' : 'bg-indigo-600 hover:bg-indigo-500 text-white'
            }`}
          >
            {saved ? (
              <span className="flex items-center justify-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                {t(language, 'saved')}
              </span>
            ) : t(language, 'saveSettings')}
          </button>
          <button
            onClick={onClose}
            className="px-5 py-2.5 text-sm text-slate-400 hover:text-white bg-slate-700 hover:bg-slate-600 rounded-xl transition-colors"
          >
            {t(language, 'close')}
          </button>
        </div>
      </div>
    </div>
  );
}

function ThemeOptionButton({
  active, onClick, icon, label, activeColor,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  activeColor: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium border transition-all duration-150 ${
        active
          ? activeColor
          : 'bg-slate-900/60 border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-600'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
    </svg>
  ) : (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  );
}
