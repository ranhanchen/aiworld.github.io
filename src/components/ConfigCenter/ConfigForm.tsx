import { useState, useCallback, useEffect, useRef } from 'react';
import type { GameConfig, ConfigTabKey, ApiConfig } from '@/types/config';
import { getActiveApi } from '@/types/config';
import { migrateGameConfig } from '@/utils/configMigration';
import TabPanel from '@/components/ConfigCenter/TabPanel';

interface ConfigFormProps {
  initialConfig?: GameConfig;
  onSave: (config: GameConfig) => void;
  onCancel: () => void;
  saveMessage: string | null;
  onClearMessage: () => void;
  saveTitle?: string;
  onSaveTitleChange?: (title: string) => void;
  chatMode?: boolean;
}


export default function ConfigForm({ initialConfig, onSave, onCancel, saveMessage, onClearMessage, saveTitle, onSaveTitleChange, chatMode }: ConfigFormProps) {
  const [config, setConfig] = useState<GameConfig>(() => {
    return migrateGameConfig(initialConfig);
  });
  const [activeTab, setActiveTab] = useState<ConfigTabKey>(chatMode ? 'network' : 'world');
  const [aiGenerating, setAiGenerating] = useState<Record<string, boolean>>({});
  const [localMessage, setLocalMessage] = useState<string | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>(() => {
    try {
      const cached = localStorage.getItem('ta_cached_models');
      if (cached) {
        const parsed: unknown = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.every((v): v is string => typeof v === 'string')) {
          return parsed;
        }
      }
    } catch { /* ignore corrupt cache */ }
    return [];
  });
  const [showCustomModel, setShowCustomModel] = useState(false);
  const [fetchModelsError, setFetchModelsError] = useState<string | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const modelSelectRef = useRef<HTMLSelectElement>(null);
  const justFetchedModelsRef = useRef(false);

  useEffect(() => {
    if (!justFetchedModelsRef.current) return;
    justFetchedModelsRef.current = false;

    if (modelSelectRef.current) {
      const timer = setTimeout(() => {
        try { modelSelectRef.current?.showPicker?.(); } catch { /* not supported */ }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [availableModels]);

  useEffect(() => {
    if (saveMessage) {
      setLocalMessage(saveMessage);
      onClearMessage();
    }
  }, [saveMessage, onClearMessage]);

  useEffect(() => {
    if (!localMessage) return;
    const timer = setTimeout(() => setLocalMessage(null), 2200);
    return () => clearTimeout(timer);
  }, [localMessage]);

  const updateNetwork = useCallback(
    (field: string, value: string | number) => {
      setConfig((prev) => ({
        ...prev,
        network: {
          ...prev.network,
          apis: prev.network.apis.map((api) =>
            api.id === prev.network.selectedId ? { ...api, [field]: value } : api,
          ),
        },
      }));
    },
    [],
  );

  const addApiConfig = useCallback(() => {
    setConfig((prev) => {
      const newId = 'api_' + Date.now();
      const count = prev.network.apis.length + 1;
      const newApi: ApiConfig = {
        id: newId,
        label: `API ${count}`,
        apiEndpoint: 'https://api.openai.com/v1/chat/completions',
        apiKey: '',
        modelName: 'gpt-4o',
        temperature: 0.8,
        topP: 0.95,
      };
      return {
        ...prev,
        network: {
          apis: [...prev.network.apis, newApi],
          selectedId: newId,
        },
      };
    });
  }, []);

  const removeApiConfig = useCallback((id: string) => {
    setConfig((prev) => {
      const remaining = prev.network.apis.filter((a) => a.id !== id);
      if (remaining.length === 0) return prev;
      const newSelectedId = prev.network.selectedId === id
        ? remaining[0].id
        : prev.network.selectedId;
      return {
        ...prev,
        network: { apis: remaining, selectedId: newSelectedId },
      };
    });
  }, []);

  const selectApi = useCallback((id: string) => {
    setConfig((prev) => ({
      ...prev,
      network: { ...prev.network, selectedId: id },
    }));
  }, []);

  const updateApiLabel = useCallback((id: string, label: string) => {
    setConfig((prev) => ({
      ...prev,
      network: {
        ...prev.network,
        apis: prev.network.apis.map((api) =>
          api.id === id ? { ...api, label } : api,
        ),
      },
    }));
  }, []);

  const activeApi = getActiveApi(config.network);

  const updateSystem = useCallback(
    (field: string, value: string | number | boolean) => {
      setConfig((prev) => ({
        ...prev,
        system: { ...prev.system, [field]: value },
      }));
    },
    [],
  );

  const updateWorld = useCallback(
    (field: string, value: string) => {
      setConfig((prev) => ({
        ...prev,
        world: { ...prev.world, [field]: value },
      }));
    },
    [],
  );

  const updateCharacter = useCallback(
    (field: string, value: string | string[]) => {
      setConfig((prev) => ({
        ...prev,
        character: { ...prev.character, [field]: value },
      }));
    },
    [],
  );

  const updateWinCondition = useCallback(
    (field: string, value: string | string[]) => {
      setConfig((prev) => ({
        ...prev,
        winCondition: { ...prev.winCondition, [field]: value },
      }));
    },
    [],
  );

  const updateAiRestriction = useCallback(
    (field: string, value: string) => {
      setConfig((prev) => ({
        ...prev,
        aiRestriction: { ...prev.aiRestriction, [field]: value },
      }));
    },
    [],
  );

  const addCustomField = useCallback(
    (section: 'world' | 'aiRestriction' | 'character' | 'winCondition') => {
      setConfig((prev) => {
        const sectionData = prev[section];
        const existingKeys = Object.keys(sectionData.customFields);
        let counter = 1;
        let tempKey = `__new_${counter}`;
        while (existingKeys.includes(tempKey)) {
          counter++;
          tempKey = `__new_${counter}`;
        }
        return {
          ...prev,
          [section]: {
            ...sectionData,
            customFields: {
              ...sectionData.customFields,
              [tempKey]: '',
            },
          },
        };
      });
    },
    [],
  );

  const updateCustomField = useCallback(
    (
      section: 'world' | 'aiRestriction' | 'character' | 'winCondition',
      oldKey: string,
      newKey: string,
      value: string,
    ) => {
      setConfig((prev) => {
        const sectionData = prev[section];
        const entries = Object.entries(sectionData.customFields);
        const newCustomFields: Record<string, string> = {};

        for (const [k, v] of entries) {
          if (k === oldKey) {
            let actualNewKey = newKey;
            if (!newKey.trim()) {
              const otherKeys = entries.map(([ek]) => ek).filter((ek) => ek !== oldKey);
              let counter = 1;
              let tempKey = `__new_${counter}`;
              while (otherKeys.includes(tempKey)) {
                counter++;
                tempKey = `__new_${counter}`;
              }
              actualNewKey = tempKey;
            } else if (newKey !== oldKey) {
              const otherKeys = entries.map(([ek]) => ek).filter((ek) => ek !== oldKey);
              if (otherKeys.includes(newKey)) {
                actualNewKey = oldKey;
              }
            }
            newCustomFields[actualNewKey] = value;
          } else {
            newCustomFields[k] = v;
          }
        }

        return {
          ...prev,
          [section]: {
            ...sectionData,
            customFields: newCustomFields,
          },
        };
      });
    },
    [],
  );

  const handleAiGenerate = useCallback(async (fieldName: string, section: string) => {
    setAiGenerating((prev) => ({ ...prev, [fieldName]: true }));
    try {
      if (!activeApi || !activeApi.apiKey) {
        alert('请先在"网络配置"选项卡中设置API密钥');
        setAiGenerating((prev) => ({ ...prev, [fieldName]: false }));
        return;
      }

      const currentValue = getFieldValue(config, fieldName, section);
      const { systemPrompt, userPrompt } = buildFieldGenerationPrompt(config, fieldName, currentValue);
      const controller = new AbortController();

      const response = await fetch(activeApi.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${activeApi.apiKey}`,
        },
        body: JSON.stringify({
          model: activeApi.modelName,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.9,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        console.error('AI generation failed:', errorText);
        return;
      }

      const data = await response.json();
      const generatedText = data.choices?.[0]?.message?.content?.trim() || '';

      if (generatedText) {
        if (section === 'world') {
          updateWorld(fieldName, generatedText);
        } else if (section === 'aiRestriction') {
          updateAiRestriction(fieldName, generatedText);
        } else if (section === 'character') {
          updateCharacter(fieldName, generatedText);
        } else if (section === 'winCondition') {
          updateWinCondition(fieldName, generatedText);
        }
      }
    } catch (err) {
      console.error('AI generation error:', err);
    } finally {
      setAiGenerating((prev) => ({ ...prev, [fieldName]: false }));
    }
  }, [config, updateWorld, updateAiRestriction, updateCharacter, updateWinCondition]);

  const handleFetchModels = useCallback(async () => {
    if (!activeApi) return;
    const { apiEndpoint, apiKey } = activeApi;
    if (!apiKey.trim()) {
      setFetchModelsError('请先填写API密钥');
      return;
    }
    if (!apiEndpoint.trim()) {
      setFetchModelsError('请先填写API端点');
      return;
    }

    setFetchingModels(true);
    setFetchModelsError(null);

    try {
      const baseUrl = apiEndpoint.replace(/\/chat\/completions\/?$/, '');
      const modelsUrl = `${baseUrl}/models`;

      const response = await fetch(modelsUrl, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}${errorText ? ': ' + errorText.slice(0, 100) : ''}`);
      }

      const data: { data?: Array<{ id: string }> } = await response.json();
      const modelIds = (data.data || [])
        .map((m) => m.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
        .sort();

      if (modelIds.length === 0) {
        setFetchModelsError('未获取到任何模型');
        return;
      }

      setAvailableModels(modelIds);
      justFetchedModelsRef.current = true;
      try { localStorage.setItem('ta_cached_models', JSON.stringify(modelIds)); } catch { /* quota exceeded */ }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setFetchModelsError(message);
    } finally {
      setFetchingModels(false);
    }
  }, [activeApi]);

  const handleTestConnection = useCallback(async () => {
    if (!activeApi) return;
    const { apiEndpoint, apiKey } = activeApi;
    if (!apiKey.trim()) {
      setTestResult({ success: false, message: '请先填写API密钥' });
      return;
    }
    if (!apiEndpoint.trim()) {
      setTestResult({ success: false, message: '请先填写API端点' });
      return;
    }

    setTestingConnection(true);
    setTestResult(null);

    try {
      const response = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: activeApi.modelName || 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 5,
          stream: false,
        }),
      });

      if (response.ok) {
        setTestResult({ success: true, message: '连接成功！大模型API可正常使用' });
      } else {
        const errorText = await response.text().catch(() => '');
        setTestResult({
          success: false,
          message: `连接失败 (HTTP ${response.status})${errorText ? ': ' + errorText.slice(0, 80) : ''}`,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setTestResult({ success: false, message: `网络错误: ${message}` });
    } finally {
      setTestingConnection(false);
    }
  }, [activeApi]);

  const handleSelectModel = useCallback((modelId: string) => {
    if (modelId === '__custom__') {
      setShowCustomModel(true);
      return;
    }
    setShowCustomModel(false);
    updateNetwork('modelName', modelId);
  }, [updateNetwork]);

  return (
    <div className="max-w-[90%] mx-auto">
      <TabPanel activeTab={activeTab} onTabChange={setActiveTab} chatMode={chatMode}>
        {activeTab === 'network' && (
          <div className="space-y-4">
            {config.network.apis.length > 1 && (
              <div className="flex flex-wrap gap-2 pb-2 border-b border-gray-100 dark:border-gray-700">
                {config.network.apis.map((api) => (
                  <button
                    key={api.id}
                    onClick={() => selectApi(api.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors min-h-[44px] ${
                      api.id === config.network.selectedId
                        ? 'bg-accent text-white'
                        : 'bg-gray-100 dark:bg-gray-700 text-text-secondary dark:text-text-secondary-dark hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    {api.label || '未命名'}
                  </button>
                ))}
              </div>
            )}

            {activeApi && (
              <>
                <FieldRow label="API名称">
                  <input
                    type="text"
                    value={activeApi.label}
                    onChange={(e) => updateApiLabel(activeApi.id, e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                    placeholder="例如：GPT-4o、Claude、DeepSeek"
                  />
                </FieldRow>
                <FieldRow label="API端点">
                  <input
                    type="text"
                    value={activeApi.apiEndpoint}
                    onChange={(e) => updateNetwork('apiEndpoint', e.target.value)}
                    onBlur={(e) => {
                      const raw = e.target.value.trim();
                      if (!raw) return;
                      if (raw.endsWith('/v1/chat/completions')) return;
                      const cleaned = raw.replace(/\/+$/, '');
                      const suffix = cleaned.endsWith('/v1') ? '/chat/completions'
                        : cleaned.endsWith('/v1/chat') ? '/completions'
                        : '/v1/chat/completions';
                      updateNetwork('apiEndpoint', cleaned + suffix);
                    }}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                    placeholder="https://api.openai.com/v1/chat/completions"
                  />
                </FieldRow>
                <FieldRow label="API密钥">
                  <input
                    type="password"
                    value={activeApi.apiKey}
                    onChange={(e) => updateNetwork('apiKey', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                    placeholder="sk-..."
                  />
                </FieldRow>
                <FieldRow label="模型名称">
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <select
                        ref={modelSelectRef}
                        value={showCustomModel ? '__custom__' : activeApi.modelName}
                        onChange={(e) => handleSelectModel(e.target.value)}
                        className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-accent min-h-[44px] overflow-hidden"
                      >
                        {!availableModels.some((m) => m === activeApi.modelName) && activeApi.modelName && !showCustomModel && (
                          <option value={activeApi.modelName}>{activeApi.modelName}</option>
                        )}
                        {availableModels.map((modelId) => (
                          <option key={modelId} value={modelId}>{modelId}</option>
                        ))}
                        <option value="__custom__">自定义输入...</option>
                      </select>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleFetchModels();
                        }}
                        disabled={fetchingModels}
                        className={`shrink-0 px-3 py-2 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-lg text-xs font-medium hover:opacity-90 transition-opacity min-h-[44px] ${
                          fetchingModels ? 'opacity-50' : ''
                        }`}
                        title={availableModels.length > 0 ? `已缓存 ${availableModels.length} 个模型，点击刷新` : '获取可用模型列表'}
                      >
                        {fetchingModels ? (
                          <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : (
                          '获取模型'
                        )}
                      </button>
                    </div>
                    {fetchModelsError && (
                      <p className="text-xs text-red-500">{fetchModelsError}</p>
                    )}
                    {showCustomModel && (
                      <input
                        type="text"
                        value={activeApi.modelName}
                        onChange={(e) => updateNetwork('modelName', e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                        placeholder="输入自定义模型名称..."
                        autoFocus
                      />
                    )}
                  </div>
                </FieldRow>
                <FieldRow label="温度 (0-2)">
                  <input
                    type="number"
                    value={activeApi.temperature}
                    onChange={(e) => updateNetwork('temperature', Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                    min={0}
                    max={2}
                    step={0.1}
                  />
                </FieldRow>
              </>
            )}

            <div className="flex gap-2 pt-2 border-t border-gray-100 dark:border-gray-700">
              <button
                onClick={addApiConfig}
                className="px-4 py-2 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-lg text-base font-medium hover:opacity-90 transition-opacity min-h-[44px]"
              >
                添加API
              </button>
              {activeApi && config.network.apis.length > 1 && (
                <button
                  onClick={() => {
                    if (window.confirm('确定要删除 "' + (activeApi.label || '未命名') + '" 这个API配置吗？')) {
                      removeApiConfig(activeApi.id);
                    }
                  }}
                  className="px-4 py-2 bg-red-500 text-white rounded-lg text-base font-medium hover:opacity-90 transition-opacity min-h-[44px]"
                >
                  删除当前API
                </button>
              )}
              <button
                onClick={handleTestConnection}
                disabled={testingConnection}
                className={`px-4 py-2 bg-gradient-to-r from-green-500 to-emerald-500 text-white rounded-lg text-base font-medium hover:opacity-90 transition-opacity min-h-[44px] ${
                  testingConnection ? 'opacity-50' : ''
                }`}
              >
                {testingConnection ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    测试中...
                  </span>
                ) : (
                  '测试连接'
                )}
              </button>
            </div>
            {testResult && (
              <p className={`text-xs ${testResult.success ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                {testResult.message}
              </p>
            )}
          </div>
        )}

        {activeTab === 'system' && (
          <div className="space-y-4">
            {!chatMode && onSaveTitleChange !== undefined && (
              <FieldRow label="存档名">
                <input
                  type="text"
                  value={saveTitle ?? ''}
                  onChange={(e) => onSaveTitleChange(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                  placeholder="给你的冒险取个名字..."
                />
              </FieldRow>
            )}
            <FieldRow label="语言">
              <select
                value={config.system.language}
                onChange={(e) => updateSystem('language', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="zh-CN">中文</option>
                <option value="en-US">English</option>
              </select>
            </FieldRow>
            <FieldRow label="字体大小">
              <select
                value={config.system.fontSize}
                onChange={(e) => updateSystem('fontSize', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="small">小</option>
                <option value="medium">中</option>
                <option value="large">大</option>
              </select>
            </FieldRow>
            <label className="flex items-center gap-2 cursor-pointer min-h-[44px]">
              <input
                type="checkbox"
                checked={config.system.autoScroll}
                onChange={(e) => updateSystem('autoScroll', e.target.checked)}
                className="w-4 h-4 rounded accent-accent"
              />
              <span className="text-lg">自动滚动</span>
            </label>
          </div>
        )}

        {activeTab === 'world' && (
          <div className="space-y-4">
            <FieldWithGenerate
              label="世界观"
              value={config.world.world}
              onChange={(v) => updateWorld('world', v)}
              onGenerate={() => handleAiGenerate('world', 'world')}
              generating={aiGenerating['world']}
              placeholder="描述这个世界的完整设定，包括时代背景、社会结构、历史事件、魔法/科技体系等..."
              multiline
            />
            <FieldWithGenerate
              label="地图"
              value={config.world.map}
              onChange={(v) => updateWorld('map', v)}
              onGenerate={() => handleAiGenerate('map', 'world')}
              generating={aiGenerating['map']}
              placeholder="描述世界的地理环境、重要地点、区域划分等..."
              multiline
            />
            <FieldWithGenerate
              label="关键角色"
              value={config.world.keyCharacters}
              onChange={(v) => updateWorld('keyCharacters', v)}
              onGenerate={() => handleAiGenerate('keyCharacters', 'world')}
              generating={aiGenerating['keyCharacters']}
              placeholder="描述故事中关键NPC、势力首领、重要角色等..."
              multiline
            />
            {Object.entries(config.world.customFields).map(([key, value], idx) => (
              <CustomFieldRow
                key={`world-cf-${idx}`}
                fieldKey={key}
                value={value}
                onUpdate={(newKey, newVal) => updateCustomField('world', key, newKey, newVal)}
              />
            ))}
            <button
              onClick={() => addCustomField('world')}
              className="text-xs text-accent hover:underline"
            >
              + 添加自定义属性
            </button>
          </div>
        )}

        {activeTab === 'aiRestriction' && (
          <div className="space-y-4">
            <FieldWithGenerate
              label="AI输出文笔"
              value={config.aiRestriction.aiTone}
              onChange={(v) => updateAiRestriction('aiTone', v)}
              onGenerate={() => handleAiGenerate('aiTone', 'aiRestriction')}
              generating={aiGenerating['aiTone']}
              placeholder="描述AI在生成故事时应遵循的风格、语气、叙事节奏、禁忌等..."
              multiline
            />
            <FieldRow label="AI底层设定">
              <textarea
                value={config.aiRestriction.aiBasePrompt}
                onChange={(e) => updateAiRestriction('aiBasePrompt', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-accent resize-y"
                placeholder="告诉AI如何理解玩家输入，以及如何回复的底层规则..."
                rows={6}
              />
            </FieldRow>
            {Object.entries(config.aiRestriction.customFields).map(([key, value], idx) => (
              <CustomFieldRow
                key={`airestriction-cf-${idx}`}
                fieldKey={key}
                value={value}
                onUpdate={(newKey, newVal) => updateCustomField('aiRestriction', key, newKey, newVal)}
              />
            ))}
            <button
              onClick={() => addCustomField('aiRestriction')}
              className="text-xs text-accent hover:underline"
            >
              + 添加自定义属性
            </button>
          </div>
        )}

        {activeTab === 'character' && (
          <div className="space-y-4">
            <FieldRow label="角色姓名">
              <input
                type="text"
                value={config.character.name}
                onChange={(e) => updateCharacter('name', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder="主角的名字"
              />
            </FieldRow>
            <FieldRow label="性别">
              <input
                type="text"
                value={config.character.gender}
                onChange={(e) => updateCharacter('gender', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder="如：男、女、其他"
              />
            </FieldRow>
            <FieldWithGenerate
              label="初始信息"
              value={config.character.background}
              onChange={(v) => updateCharacter('background', v)}
              onGenerate={() => handleAiGenerate('background', 'character')}
              generating={aiGenerating['background']}
              placeholder="概括角色的出身、经历和核心特征..."
              multiline
            />
            <FieldWithGenerate
              label="职业"
              value={config.character.occupation}
              onChange={(v) => updateCharacter('occupation', v)}
              onGenerate={() => handleAiGenerate('occupation', 'character')}
              generating={aiGenerating['occupation']}
              placeholder="如：街头佣兵、学院法师..."
              multiline
            />
            <FieldWithGenerate
              label="特殊能力"
              value={config.character.personality}
              onChange={(v) => updateCharacter('personality', v)}
              onGenerate={() => handleAiGenerate('personality', 'character')}
              generating={aiGenerating['personality']}
              placeholder="如：时间感知、读心术、变身、元素操控..."
              multiline
            />
            <FieldWithGenerate
              label="外貌"
              value={config.character.appearance}
              onChange={(v) => updateCharacter('appearance', v)}
              onGenerate={() => handleAiGenerate('appearance', 'character')}
              generating={aiGenerating['appearance']}
              placeholder="描述角色的外貌特征..."
              multiline
            />
            {Object.entries(config.character.customFields).map(([key, value], idx) => (
              <CustomFieldRow
                key={`char-cf-${idx}`}
                fieldKey={key}
                value={value}
                onUpdate={(newKey, newVal) => updateCustomField('character', key, newKey, newVal)}
              />
            ))}
            <button
              onClick={() => addCustomField('character')}
              className="text-xs text-accent hover:underline"
            >
              + 添加自定义属性
            </button>
          </div>
        )}

        {activeTab === 'winCondition' && (
          <div className="space-y-4">
            <FieldWithGenerate
              label="主要目标"
              value={config.winCondition.mainGoal}
              onChange={(v) => updateWinCondition('mainGoal', v)}
              onGenerate={() => handleAiGenerate('mainGoal', 'winCondition')}
              generating={aiGenerating['mainGoal']}
              placeholder="如：击败魔王、找到失落的宝藏..."
              multiline
            />

            <div>
              <label className="block text-lg font-medium mb-1.5">次要目标</label>
              {config.winCondition.subGoals.map((goal, idx) => (
                <div key={`subgoal-${idx}`} className="flex gap-2 mb-1.5">
                  <textarea
                    value={goal}
                    onChange={(e) => {
                      const updated = [...config.winCondition.subGoals];
                      updated[idx] = e.target.value;
                      updateWinCondition('subGoals', updated);
                    }}
                    className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-accent resize-y"
                    placeholder="如：结识一位盟友"
                    rows={2}
                  />
                  <button
                    onClick={() => {
                      const updated = config.winCondition.subGoals.filter((_, i) => i !== idx);
                      updateWinCondition('subGoals', updated);
                    }}
                    className="px-2 py-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded text-xs min-h-[44px]"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                onClick={() => updateWinCondition('subGoals', [...config.winCondition.subGoals, ''])}
                className="text-xs text-accent hover:underline"
              >
                + 添加次要目标
              </button>
            </div>

            <div>
              <label className="block text-lg font-medium mb-1.5">失败条件</label>
              {config.winCondition.failureConditions.map((cond, idx) => (
                <div key={`failcond-${idx}`} className="flex gap-2 mb-1.5">
                  <textarea
                    value={cond}
                    onChange={(e) => {
                      const updated = [...config.winCondition.failureConditions];
                      updated[idx] = e.target.value;
                      updateWinCondition('failureConditions', updated);
                    }}
                    className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-accent resize-y"
                    placeholder="如：主角生命归零"
                    rows={2}
                  />
                  <button
                    onClick={() => {
                      const updated = config.winCondition.failureConditions.filter((_, i) => i !== idx);
                      updateWinCondition('failureConditions', updated);
                    }}
                    className="px-2 py-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded text-xs min-h-[44px]"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                onClick={() => updateWinCondition('failureConditions', [...config.winCondition.failureConditions, ''])}
                className="text-xs text-accent hover:underline"
              >
                + 添加失败条件
              </button>
            </div>

            {Object.entries(config.winCondition.customFields).map(([key, value], idx) => (
              <CustomFieldRow
                key={`wc-cf-${idx}`}
                fieldKey={key}
                value={value}
                onUpdate={(newKey, newVal) => updateCustomField('winCondition', key, newKey, newVal)}
              />
            ))}
            <button
              onClick={() => addCustomField('winCondition')}
              className="text-xs text-accent hover:underline"
            >
              + 添加自定义属性
            </button>
          </div>
        )}
      </TabPanel>

      <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200 dark:border-gray-700">
        {localMessage && (
          <div className="flex-1 flex items-center justify-start">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 text-base font-medium rounded-lg border border-green-200 dark:border-green-800 animate-fade-in">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {localMessage}
            </span>
          </div>
        )}
        <button
          onClick={onCancel}
          className="px-4 py-2 text-lg text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark transition-colors min-h-[44px]"
        >
          取消
        </button>
        <button
          onClick={() => onSave(config)}
          className="px-6 py-2 bg-accent text-white text-lg font-medium rounded-lg hover:opacity-90 transition-opacity min-h-[44px]"
        >
          保存设定
        </button>
      </div>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-lg font-medium mb-1.5">{label}</label>
      {children}
    </div>
  );
}

interface FieldWithGenerateProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onGenerate: () => void;
  generating: boolean;
  placeholder: string;
  multiline?: boolean;
}

function FieldWithGenerate({
  label,
  value,
  onChange,
  onGenerate,
  generating,
  placeholder,
  multiline,
}: FieldWithGenerateProps) {
  const inputClass =
    'w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-base focus:outline-none focus:ring-2 focus:ring-accent';

  return (
    <FieldRow label={label}>
      <div className="flex gap-2">
        {multiline ? (
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={inputClass}
            placeholder={placeholder}
            rows={5}
          />
        ) : (
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={inputClass}
            placeholder={placeholder}
          />
        )}
        <button
          onClick={onGenerate}
          disabled={generating}
          className={`shrink-0 px-3 py-2 bg-gradient-to-r from-purple-500 to-indigo-500 text-white rounded-lg text-xs font-medium hover:opacity-90 transition-opacity min-h-[44px] ${
            generating ? 'opacity-50' : ''
          }`}
          title="AI自动生成"
        >
          {generating ? (
            <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            'AI生成'
          )}
        </button>
      </div>
    </FieldRow>
  );
}

interface CustomFieldRowProps {
  fieldKey: string;
  value: string;
  onUpdate: (key: string, value: string) => void;
}

function CustomFieldRow({ fieldKey, value, onUpdate }: CustomFieldRowProps) {
  const displayKey = fieldKey.startsWith('__new_') ? '' : fieldKey;
  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <input
          type="text"
          value={displayKey}
          onChange={(e) => onUpdate(e.target.value, value)}
          className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          placeholder="属性名"
        />
      </div>
      <textarea
        value={value}
        onChange={(e) => onUpdate(fieldKey, e.target.value)}
        className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
        placeholder="属性值"
        rows={5}
      />
    </div>
  );
}

function getFieldValue(config: GameConfig, fieldName: string, section: string): string {
  if (section === 'world') {
    return String((config.world as unknown as Record<string, unknown>)[fieldName] ?? '');
  }
  if (section === 'character') {
    return String((config.character as unknown as Record<string, unknown>)[fieldName] ?? '');
  }
  if (section === 'winCondition') {
    return String((config.winCondition as unknown as Record<string, unknown>)[fieldName] ?? '');
  }
  return '';
}

const FIELD_INSTRUCTIONS: Record<string, { role: string; format: string }> = {
  world: {
    role: '世界观设计师',
    format: '完整的世界观设定，应包含时代背景、社会结构、历史事件、文化特色、魔法/科技体系等。如"这是一个近未来的赛博朋克世界，巨型企业控制了社会的一切。人类可以通过植入芯片增强能力，但贫富差距极端。地下反抗组织在企业的高压统治下秘密活动，而一场数字瘟疫正在虚拟空间蔓延..."',
  },
  map: {
    role: '世界观设计师',
    format: '世界地图与地理位置描述，应包含重要地点、区域分布、地理特征。如"新东京 - 霓虹笼罩的巨型都市，分为上城（企业精英区）、中城（普通居民区）和下城（贫民窟与黑市）；废铁荒漠 - 城外的辐射污染区，散落着旧时代的科技残骸..."',
  },
  keyCharacters: {
    role: '世界观设计师',
    format: '关键角色列表与描述，包括NPC、势力首领、盟友/敌人等。如"山田社长 - 天成企业的CEO，冷酷精明的中年男子，掌控新东京的能源供应；红狐 - 反抗军领袖，神秘的黑客，从未有人见过真面目..."',
  },
  aiTone: {
    role: '叙事指导',
    format: 'AI输出文笔要求，描述叙事风格、语气、节奏控制、禁忌等。如"采用黑暗冷峻的叙事风格，注重氛围描写和心理刻画。叙述者保持中立客观，不直接评判角色行为。对话应展现角色性格，推动剧情发展。避免说教和过度乐观的桥段，保持世界观的严肃性。"',
  },
  aiBasePrompt: {
    role: '系统设定',
    format: 'AI底层设定，定义AI如何理解玩家输入和如何回复的核心规则。这是AI的基础行为准则，如"你是一个专业的文字冒险游戏叙述者。玩家输入的文字代表主角的行动和对话。请根据游戏设定和上下文，生成符合世界观的剧情回复。"',
  },
  background: {
    role: '角色编剧',
    format: '初始信息，概括角色的出身、经历、身份和核心特征，2-3句话即可，如"出身贫民窟的年轻佣兵，幼年目睹家人被害后被老佣兵收养，练就一身战斗本领，性格坚毅但内心藏着复仇之火"',
  },
  gender: {
    role: '角色编剧',
    format: '性别描述，如"男"、"女"、"未知"、"双性"等，可附带简短说明',
  },
  occupation: {
    role: '角色编剧',
    format: '职业身份，如"街头佣兵"、"学院法师"、"流浪武士"、"赏金猎人"等，应与世界观设定契合',
  },
  personality: {
    role: '角色编剧',
    format: '特殊能力，如"时间感知 - 能预见3秒后的未来"、"暗影步 - 在阴影中瞬间移动"、"元素亲和 - 与风元素共鸣可操控气流"等，描述能力的来源、效果和限制',
  },
  appearance: {
    role: '角色编剧',
    format: '外貌描述，包括体型、面容特征、发色瞳色、穿着风格和标志性配饰，如"瘦高身材，黑色短发遮住左眼伤疤，常年披着褪色的暗红斗篷"',
  },
  mainGoal: {
    role: '剧情设计师',
    format: '主线目标，如"击败魔王拯救濒临毁灭的王国"、"在废土中寻找传说中的绿洲"、"揭开身世之谜并向仇人复仇"等，应有明确的驱动力和最终形态',
  },
};

function buildFieldGenerationPrompt(
  config: GameConfig,
  fieldName: string,
  currentValue: string,
): { systemPrompt: string; userPrompt: string } {
  const fullContext = buildFullContext(config, fieldName);
  const instruction = FIELD_INSTRUCTIONS[fieldName] ?? {
    role: '创意写作助手',
    format: `${fieldName}字段的内容`,
  };

  const systemPrompt = `你是一名专业的${instruction.role}，专精于文字冒险游戏的设定创作。你的任务是生成高质量、有创意、符合上下文的字段内容。请直接输出生成结果，不要带任何解释、前缀或引号。`;

  let userPrompt = `请为文字冒险游戏生成「${fieldName}」字段的内容。\n\n`;

  if (fullContext) {
    userPrompt += `## 已设定的上下文\n${fullContext}\n\n`;
  }

  if (currentValue.trim()) {
    userPrompt += `## 用户当前输入的方向\n${currentValue}\n\n`;
  }

  userPrompt += `## 该字段的要求\n${instruction.format}\n\n`;
  userPrompt += `请根据以上所有信息，生成最合适的「${fieldName}」内容。`;

  return { systemPrompt, userPrompt };
}

function buildFullContext(config: GameConfig, excludeField: string): string {
  const lines: string[] = [];

  const add = (label: string, value: string | string[] | undefined | null) => {
    const v = Array.isArray(value) ? value.filter(Boolean).join('、') : value;
    if (v && v.trim()) {
      lines.push(`- ${label}：${v}`);
    }
  };

  if (excludeField !== 'world') add('世界观', config.world.world);
  if (excludeField !== 'map') add('地图', config.world.map);
  if (excludeField !== 'keyCharacters') add('关键角色', config.world.keyCharacters);

  for (const [k, v] of Object.entries(config.world.customFields)) {
    if (v.trim()) add(k, v);
  }

  if (excludeField !== 'aiTone') add('AI输出文笔', config.aiRestriction.aiTone);
  if (excludeField !== 'aiBasePrompt') add('AI底层设定', config.aiRestriction.aiBasePrompt);

  for (const [k, v] of Object.entries(config.aiRestriction.customFields)) {
    if (v.trim()) add(k, v);
  }

  if (excludeField !== 'name') add('角色姓名', config.character.name);
  add('性别', config.character.gender);
  add('年龄', config.character.age);
  if (excludeField !== 'background') add('人物简介', config.character.background);
  if (excludeField !== 'occupation') add('职业', config.character.occupation);
  if (excludeField !== 'personality') add('特殊能力', config.character.personality);
  if (excludeField !== 'appearance') add('外貌', config.character.appearance);
  add('技能', config.character.skills);

  for (const [k, v] of Object.entries(config.character.customFields)) {
    if (v.trim()) add(k, v);
  }

  if (excludeField !== 'mainGoal') add('主要目标', config.winCondition.mainGoal);
  add('次要目标', config.winCondition.subGoals);
  add('失败条件', config.winCondition.failureConditions);

  for (const [k, v] of Object.entries(config.winCondition.customFields)) {
    if (v.trim()) add(k, v);
  }

  add('语言', config.system.language);

  return lines.join('\n');
}
