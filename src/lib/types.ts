/** types.ts — 跨页共享类型 */

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}
