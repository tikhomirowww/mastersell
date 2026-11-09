export const WHATSAPP_INCOMING_QUEUE = 'whatsapp-incoming';

export type WhatsAppIncomingJob =
  | { kind: 'text'; key: string; instanceId: string; phone: string; name?: string; text: string }
  | { kind: 'audio'; key: string; instanceId: string; phone: string; name?: string; downloadUrl: string };
