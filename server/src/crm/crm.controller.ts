import {
  Controller, Get, Post, Put, Delete,
  Param, Body, Query, HttpCode,
} from '@nestjs/common';
import { CrmService } from './crm.service';
import { TenantId } from '../auth/decorators';
import {
  CreateContactDto, UpdateContactDto, UpdateStageDto,
  CreateNoteDto, CreateTagDto, ContactsQueryDto,
} from './dto/contact.dto';

@Controller('crm')
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  // ─── Contacts ──────────────────────────────────────────────────────────────

  @Get('contacts')
  getContacts(@TenantId() tenantId: string, @Query() query: ContactsQueryDto) {
    return this.crm.getContacts(tenantId, query);
  }

  @Post('contacts')
  createContact(@TenantId() tenantId: string, @Body() dto: CreateContactDto) {
    return this.crm.createContact(tenantId, dto);
  }

  @Get('contacts/:id')
  getContact(@Param('id') id: string) {
    return this.crm.getContact(id);
  }

  @Put('contacts/:id')
  updateContact(@Param('id') id: string, @Body() dto: UpdateContactDto) {
    return this.crm.updateContact(id, dto);
  }

  @Delete('contacts/:id')
  @HttpCode(204)
  deleteContact(@Param('id') id: string) {
    return this.crm.deleteContact(id);
  }

  @Put('contacts/:id/stage')
  updateStage(@Param('id') id: string, @Body() dto: UpdateStageDto) {
    return this.crm.updateStage(id, dto.stage);
  }

  // ─── Notes ─────────────────────────────────────────────────────────────────

  @Get('contacts/:id/notes')
  getNotes(@Param('id') id: string) {
    return this.crm.getNotes(id);
  }

  @Post('contacts/:id/notes')
  createNote(@Param('id') id: string, @Body() dto: CreateNoteDto) {
    return this.crm.createNote(id, dto);
  }

  @Delete('contacts/:id/notes/:noteId')
  @HttpCode(204)
  deleteNote(@Param('id') id: string, @Param('noteId') noteId: string) {
    return this.crm.deleteNote(id, noteId);
  }

  // ─── Tags ──────────────────────────────────────────────────────────────────

  @Get('tags')
  getAllTags(@TenantId() tenantId: string) {
    return this.crm.getAllTags(tenantId);
  }

  @Post('tags')
  createTag(@TenantId() tenantId: string, @Body() dto: CreateTagDto) {
    return this.crm.createTag(tenantId, dto);
  }

  @Post('contacts/:id/tags/:tagId')
  addTag(@Param('id') id: string, @Param('tagId') tagId: string) {
    return this.crm.addTagToContact(id, tagId);
  }

  @Delete('contacts/:id/tags/:tagId')
  @HttpCode(204)
  removeTag(@Param('id') id: string, @Param('tagId') tagId: string) {
    return this.crm.removeTagFromContact(id, tagId);
  }

  // ─── Pipeline ──────────────────────────────────────────────────────────────

  @Get('pipeline')
  getPipeline(@TenantId() tenantId: string) {
    return this.crm.getPipeline(tenantId);
  }

  // ─── Analytics ─────────────────────────────────────────────────────────────

  @Get('analytics')
  getAnalytics(@TenantId() tenantId: string) {
    return this.crm.getAnalytics(tenantId);
  }
}
