import { useState, useRef } from 'react';
import { importSaves } from '@/db/repository';

interface ImportExportProps {
  onComplete: () => void;
}

export default function ImportExport({ onComplete }: ImportExportProps) {
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    console.log('[ImportExport] 开始导入文件:', { name: file.name, size: file.size });
    setImporting(true);
    setMessage(null);

    try {
      const text = await file.text();
      console.log('[ImportExport] 文件读取成功，长度:', text.length);
      const result = await importSaves(text);
      console.log('[ImportExport] 导入结果:', result);

      if (result.imported > 0) {
        setMessage({
          type: 'success',
          text: `成功导入 ${result.imported} 个存档${result.skipped > 0 ? `，跳过 ${result.skipped} 个` : ''}`,
        });
        onComplete();
      } else if (result.errors.length > 0) {
        setMessage({ type: 'error', text: result.errors.join('；') });
      } else {
        setMessage({ type: 'error', text: '没有可导入的数据' });
      }
    } catch (e) {
      console.error('[ImportExport] 导入异常:', e);
      setMessage({ type: 'error', text: '文件读取失败，请检查文件格式' });
    } finally {
      setImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="mb-4 p-3 border border-dashed border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-800/50">
      <div className="flex items-center gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleImport}
          className="hidden"
          id="import-file"
        />
        <label
          htmlFor="import-file"
          className={`px-3 py-1.5 bg-blue-600 text-white rounded-lg text-base cursor-pointer hover:opacity-90 transition-opacity ${
            importing ? 'opacity-50 pointer-events-none' : ''
          }`}
        >
          {importing ? '导入中...' : '选择文件导入'}
        </label>
        <span className="text-base text-text-secondary dark:text-text-secondary-dark">
          支持JSON格式的存档备份文件
        </span>
      </div>
      {message && (
        <p
          className={`mt-2 text-base ${
            message.type === 'success' ? 'text-green-600 dark:text-green-400' : 'text-red-500'
          }`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
