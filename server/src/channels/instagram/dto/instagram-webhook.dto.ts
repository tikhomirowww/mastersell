// Meta Graph API Webhook payload для Instagram DM
export interface MetaWebhookEntry {
  id: string;
  messaging: MetaMessagingEvent[];
}

export interface MetaMessagingEvent {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
    is_echo?: boolean;
  };
}

export interface InstagramWebhookDto {
  object: string; // 'instagram'
  entry: MetaWebhookEntry[];
}
