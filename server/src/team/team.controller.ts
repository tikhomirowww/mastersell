import { Controller, Get, Post, Put, Delete, Param, Body } from '@nestjs/common';
import { TenantId, UserId } from '../auth/decorators';
import { TeamService } from './team.service';

@Controller('team')
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get('members')
  getMembers(@TenantId() tenantId: string) {
    return this.team.getMembers(tenantId);
  }

  @Delete('members/:id')
  removeMember(@TenantId() tenantId: string, @UserId() requesterId: string, @Param('id') id: string) {
    return this.team.removeMember(tenantId, requesterId, id);
  }

  @Put('members/:id/role')
  changeRole(
    @TenantId() tenantId: string,
    @UserId() requesterId: string,
    @Param('id') id: string,
    @Body('role') role: 'ADMIN' | 'MEMBER',
  ) {
    return this.team.changeRole(tenantId, requesterId, id, role);
  }

  @Post('invites')
  createInvite(@TenantId() tenantId: string, @UserId() userId: string) {
    return this.team.createInvite(tenantId, userId);
  }

  @Get('invites')
  getInvites(@TenantId() tenantId: string) {
    return this.team.getInvites(tenantId);
  }

  @Delete('invites/:id')
  revokeInvite(@TenantId() tenantId: string, @UserId() requesterId: string, @Param('id') id: string) {
    return this.team.revokeInvite(tenantId, requesterId, id);
  }
}
