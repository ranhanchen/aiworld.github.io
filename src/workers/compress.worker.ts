interface CompressRequest {
  id: string;
  previousSummary: string;
  messagesText: string;
}

interface CompressResponse {
  id: string;
  prompt: string;
}

self.onmessage = (event: MessageEvent<CompressRequest>) => {
  const { id, previousSummary, messagesText } = event.data;

  const prompt = `你是一个专业的文字冒险游戏记忆压缩引擎。请阅读以下对话内容并生成一个结构化的摘要。

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

  const response: CompressResponse = { id, prompt };
  self.postMessage(response);
};
