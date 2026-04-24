import type { AgentDelivery, Channel, Message } from '@mini-slock/shared';

export function toAgentDelivery(message: Message, channel: Channel): AgentDelivery {
  return {
    id: message.id,
    channelId: channel.id,
    channelName: channel.name,
    senderName: message.senderName,
    content: message.content,
    createdAt: message.createdAt,
  };
}
