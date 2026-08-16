import { Monitor, Moon, Sun } from 'lucide-react';
import { useThemeStore, type ThemeMode } from '../../store/theme';
import { IconButton } from '../ui/Button';

const LABEL: Record<ThemeMode, string> = {
  dark: 'Тема: тёмная',
  light: 'Тема: светлая',
  system: 'Тема: как в системе',
};

const NEXT: Record<ThemeMode, string> = {
  dark: 'переключить на светлую',
  light: 'переключить на системную',
  system: 'переключить на тёмную',
};

export function ThemeToggle() {
  const mode = useThemeStore((state) => state.mode);
  const cycle = useThemeStore((state) => state.cycle);

  const Icon = mode === 'dark' ? Moon : mode === 'light' ? Sun : Monitor;

  return (
    <IconButton label={`${LABEL[mode]} — ${NEXT[mode]}`} size="sm" onClick={cycle}>
      <Icon className="h-[17px] w-[17px]" aria-hidden />
    </IconButton>
  );
}
