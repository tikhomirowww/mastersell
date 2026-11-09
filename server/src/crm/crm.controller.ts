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
  getContact(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.crm.getContact(tenantId, id);
  }

  @Put('contacts/:id')
  updateContact(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateContactDto) {
    return this.crm.updateContact(tenantId, id, dto);
  }

  @Delete('contacts/:id')
  @HttpCode(204)
  deleteContact(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.crm.deleteContact(tenantId, id);
  }

  @Put('contacts/:id/stage')
  updateStage(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateStageDto) {
    return this.crm.updateStage(tenantId, id, dto.stage);
  }

  // ─── Notes ─────────────────────────────────────────────────────────────────

  @Get('contacts/:id/notes')
  getNotes(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.crm.getNotes(tenantId, id);
  }

  @Post('contacts/:id/notes')
  createNote(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: CreateNoteDto) {
    return this.crm.createNote(tenantId, id, dto);
  }

  @Delete('contacts/:id/notes/:noteId')
  @HttpCode(204)
  deleteNote(@TenantId() tenantId: string, @Param('id') id: string, @Param('noteId') noteId: string) {
    return this.crm.deleteNote(tenantId, id, noteId);
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
  addTag(@TenantId() tenantId: string, @Param('id') id: string, @Param('tagId') tagId: string) {
    return this.crm.addTagToContact(tenantId, id, tagId);
  }

  @Delete('contacts/:id/tags/:tagId')
  @HttpCode(204)
  removeTag(@TenantId() tenantId: string, @Param('id') id: string, @Param('tagId') tagId: string) {
    return this.crm.removeTagFromContact(tenantId, id, tagId);
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
