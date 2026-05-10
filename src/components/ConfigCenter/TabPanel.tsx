import type { ReactNode } from 'react';
import type { ConfigTabKey } from '@/types/config';

const TAB_LABELS: Record<ConfigTabKey, string> = {
  network: '网络设置',
  system: '系统设置',
  world: '世界观',
  aiRestriction: 'AI指令',
  character: '角色面板',
  winCondition: '获胜条件',
};

interface TabPanelProps {
  activeTab: ConfigTabKey;
  onTabChange: (tab: ConfigTabKey) => void;
  children: ReactNode;
  chatMode?: boolean;
}

export default function TabPanel({ activeTab, onTabChange, children, chatMode }: TabPanelProps) {
  const allTabs: ConfigTabKey[] = ['network', 'system', 'world', 'aiRestriction', 'character', 'winCondition'];
  const tabs = chatMode ? ['network', 'aiRestriction', 'system'] as ConfigTabKey[] : allTabs;

  return (
    <div>
      <div className="flex border-b border-gray-200 dark:border-gray-700 overflow-x-auto scrollbar-hide">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => onTabChange(tab)}
            className={`px-4 py-2.5 text-lg font-medium whitespace-nowrap min-h-[44px] transition-colors relative ${
              activeTab === tab
                ? 'text-accent border-b-2 border-accent'
                : 'text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark'
            }`}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>
      <div className="pt-4">
        {children}
      </div>
    </div>
  );
}
