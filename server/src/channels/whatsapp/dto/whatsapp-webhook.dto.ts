// Twilio WhatsApp Webhook payload
export interface WhatsAppWebhookDto {
  MessageSid: string;
  From: string;          // 'whatsapp:+996...'
  To: string;            // наш номер
  Body: string;          // текст сообщения
  ProfileName?: string;  // имя отправителя
  NumMedia?: string;
}
