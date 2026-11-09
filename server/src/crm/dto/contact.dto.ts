import { CrmStage, Language, Channel } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEmail, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateContactDto {
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() instagramId?: string;
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsEnum(Language) language?: Language;
  @IsOptional() @IsEnum(CrmStage) stage?: CrmStage;
}

export class UpdateContactDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsEnum(Language) language?: Language;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() avatarUrl?: string;
}

export class UpdateStageDto {
  @IsEnum(CrmStage) stage!: CrmStage;
}

export class CreateNoteDto {
  @IsString() @MinLength(1) @MaxLength(5000) text!: string;
}

export class CreateTagDto {
  @IsString() @MinLength(1) @MaxLength(50) name!: string;
  @IsOptional() @IsString() color?: string;
}

export class ContactsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsEnum(CrmStage) stage?: CrmStage;
  @IsOptional() @IsEnum(Channel) channel?: Channel;
  @IsOptional() @IsEnum(Language) language?: Language;
}
