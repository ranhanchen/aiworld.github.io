import { DEFAULT_API_CONFIG } from '@/config/constants';

export function createNonStreamingRequest(
  apiEndpoint: string,
  apiKey: string,
  modelName: string,
  messages: Array<{ role: string; content: string }>,
  options?: {
    temperature?: number;
    topP?: number;
  },
): { controller: AbortController; response: Promise<string> } {
  const controller = new AbortController();
  const endpoint = apiEndpoint || DEFAULT_API_CONFIG.apiEndpoint;
  const model = modelName || DEFAULT_API_CONFIG.modelName;

  console.log('[api] createNonStreamingRequest 发起请求:', { endpoint: endpoint.substring(0, 60), model, messageCount: messages.length });

  const body = JSON.stringify({
    model,
    messages,
    temperature: options?.temperature ?? DEFAULT_API_CONFIG.temperature,
    top_p: options?.topP ?? DEFAULT_API_CONFIG.topP,
    stream: false,
  });

  const response = fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body,
    signal: controller.signal,
  }).then(async (res) => {
    if (!res.ok) {
      const errorText = await res.text().catch(() => 'Unknown error');
      throw new Error(`API Error ${res.status}: ${errorText}`);
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('Invalid response format: missing content');
    }
    return content;
  });

  return { controller, response };
}

export function createSystemPrompt(config: {
  world: string;
  map: string;
  keyCharacters: string;
  aiTone: string;
  aiBasePrompt: string;
  characterName: string;
  characterGender: string;
  characterAge: string;
  characterBackground: string;
  characterOccupation: string;
  characterSkills: string[];
  characterPersonality: string;
  characterAppearance: string;
  mainGoal: string;
  subGoals: string[];
  failureConditions: string[];
  customFields?: Record<string, string>;
}): string {
  const skills = config.characterSkills.filter(Boolean).join('、') || '无特殊技能';
  const subGoals = config.subGoals.filter(Boolean).join('；') || '无';
  const failures = config.failureConditions.filter(Boolean).join('；') || '无';
  const customFieldsEntries = config.customFields
    ? Object.entries(config.customFields)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n')
    : '';

  const basePrompt = config.aiBasePrompt || `你是一个专业的文字冒险游戏叙述者。请严格遵循以下设定来构建沉浸式的互动故事体验。`;
  const toneSection = config.aiTone
    ? `\n\n## AI输出文笔要求\n${config.aiTone}`
    : '';

  return `${basePrompt}

## 世界观设定
${config.world ? config.world : '（未指定）'}

## 地图
${config.map ? config.map : '（未指定）'}
${customFieldsEntries ? `\n自定义设定：\n${customFieldsEntries}` : ''}

## 关键角色
${config.keyCharacters ? config.keyCharacters : '（未指定）'}

## 主角设定
- 姓名：${config.characterName || '未指定'}
- 性别：${config.characterGender || '未指定'}
- 年龄：${config.characterAge || '未指定'}
- 人物简介：${config.characterBackground || '未指定'}
- 职业：${config.characterOccupation || '未指定'}
- 技能：${skills}
- 特殊能力：${config.characterPersonality || '未指定'}
- 外貌：${config.characterAppearance || '未指定'}

## 目标与条件
- 主要目标：${config.mainGoal || '未指定'}
- 次要目标：${subGoals}
- 失败条件：${failures}
${toneSection}

## 输出格式要求（极其重要！）
你必须严格以JSON数组格式输出回复。数组中的每个元素是一个对象，格式如下：
[
  {"type": "scene", "content": "场景描述文本"},
  {"type": "dialogue", "speaker": "角色名", "content": "对话内容"},
  {"type": "action", "content": "动作或神态描述"},
  {"type": "system", "content": "系统提示或状态变化"}
]

类型说明：
- "scene"：用于描述场景、环境、氛围、时间推移、旁白叙述。每个scene块应是独立的场景段落。
- "dialogue"：用于角色对话。必须包含"speaker"字段标明说话者。
- "action"：用于描述角色的动作、神态、表情变化。紧贴在 dialogue 前后。
- "system"：用于系统提示、状态变化、属性变更、物品获得/失去等重要游戏机制信息。

输出规则：
1. 必须是一个合法的JSON数组，不要包含任何JSON之外的文字。
2. 每个回复至少包含2个元素。
3. dialogue类型的数量至少占总数的一半。
4. action应放在相关dialogue的前或后。
5. 故事发展要符合已有的设定和上下文。
6. 保持剧情连贯、有趣且充满选择空间。`;
}

export function createCompressionPrompt(
  previousSummary: string,
  messagesText: string,
): string {
  return `你是一个专业的文字冒险游戏记忆压缩引擎。请阅读以下对话内容并生成一个结构化的摘要。

## 已有摘要（若存在）
${previousSummary || '（无已有摘要）'}

## 需要压缩的对话内容
${messagesText}

## 压缩要求
请生成一个包含以下要素的结构化摘要：
1. **当前状态**：主角当前的位置、状态、持有的物品
2. **剧情进展**：最近发生的关键事件、转折点和重要对话
3. **角色关系**：主角与NPC之间的关系变化
4. **待解决问题**：当前未解决的任务、谜题或冲突
5. **关键信息**：可能影响未来剧情的重要细节

请用中文输出，保持简洁但信息完整。`;
}
