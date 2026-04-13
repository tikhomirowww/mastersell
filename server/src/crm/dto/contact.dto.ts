import { CrmStage, Language, Channel } from '@prisma/client';

export class CreateContactDto {
  phone?: string;
  instagramId?: string;
  name?: string;
  email?: string;
  language?: Language;
  stage?: CrmStage;
}

export class UpdateContactDto {
  name?: string;
  email?: string;
  phone?: string;
  language?: Language;
  notes?: string;
  avatarUrl?: string;
}

export class UpdateStageDto {
  stage!: CrmStage;
}

export class CreateNoteDto {
  text!: string;
}

export class CreateTagDto {
  name!: string;
  color?: string;
}

export class ContactsQueryDto {
  page?: number;
  limit?: number;
  search?: string;
  stage?: CrmStage;
  channel?: Channel;
  language?: Language;
}
