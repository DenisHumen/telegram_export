import {
  FileText,
  Film,
  Image as ImageIcon,
  Mic,
  Music,
  Paperclip,
  Smile,
  Sparkles,
  UserRound,
  Video,
} from 'lucide-react';
import { cn } from '../../lib/cn';

const ICONS: Record<string, typeof FileText> = {
  photo: ImageIcon,
  video: Film,
  video_note: Video,
  voice: Mic,
  audio: Music,
  document: FileText,
  sticker: Smile,
  animation: Sparkles,
  thumb: ImageIcon,
  avatar: UserRound,
};

/** Monochrome glyph for a `media_files.kind` value. */
export function KindIcon({ kind, className }: { kind: string; className?: string }) {
  const Icon = ICONS[kind] ?? Paperclip;
  return <Icon className={cn('h-[15px] w-[15px] shrink-0 text-muted', className)} aria-hidden />;
}
