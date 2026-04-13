import { Module, Global } from '@nestjs/common';
import { ClaudeService } from './claude.service';

@Global()
@Module({
  providers: [ClaudeService],
  exports: [ClaudeService],
})
export class ClaudeModule {}
