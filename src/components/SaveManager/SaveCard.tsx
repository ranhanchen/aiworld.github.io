import type { Save } from '@/types/save';
import { formatTimestamp } from '@/utils/formatters';
import { generateSaveTitle } from '@/utils/parsers';

interface SaveCardProps {
  save: Save;
  selected: boolean;
  onSelect: (id: string, selected: boolean) => void;
  onClick: (save: Save) => void;
  onEdit: (save: Save) => void;
  onDelete: (id: string) => void;
}

export default function SaveCard({ save, selected, onSelect, onClick, onEdit, onDelete }: SaveCardProps) {
  const title = generateSaveTitle(save.metadata);
  const coverColor = save.metadata.coverColor || '#6366f1';

  return (
    <div
      className="relative group rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer animate-fade-in"
      onClick={() => onClick(save)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(save);
        }
      }}
    >
      <div
        className="h-24 w-full"
        style={{ backgroundColor: coverColor }}
      />
      <div className="p-3">
        <h3
          className="font-semibold text-sm truncate text-text-primary dark:text-text-primary-dark"
          title={title}
        >
          {title}
        </h3>
        <p className="text-xs text-text-secondary dark:text-text-secondary-dark mt-1">
          第 {save.metadata.roundCount} 回合
        </p>
        <p className="text-xs text-text-secondary dark:text-text-secondary-dark mt-0.5">
          {formatTimestamp(save.metadata.lastPlayedAt)}
        </p>
      </div>
      <div className="absolute top-2 left-2">
        <label
          className="flex items-center justify-center w-8 h-8 rounded-full bg-black/30 hover:bg-black/50 transition-colors cursor-pointer"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onSelect(save.id, e.target.checked)}
            className="w-4 h-4 rounded border-white/50 cursor-pointer"
          />
        </label>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onEdit(save);
        }}
        className="absolute top-2 right-9 w-8 h-8 rounded-full bg-black/30 hover:bg-blue-500/80 transition-colors flex items-center justify-center opacity-60 group-hover:opacity-100"
        title="编辑设定"
      >
        <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
        </svg>
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete(save.id);
        }}
        className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/30 hover:bg-red-500/80 transition-colors flex items-center justify-center opacity-60 group-hover:opacity-100"
        title="删除存档"
      >
        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
