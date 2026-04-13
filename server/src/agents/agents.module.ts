import { Module, Global } from '@nestjs/common';
import { ClassifierService } from './classifier/classifier.service';
import { SalesService } from './sales/sales.service';

@Global()
@Module({
  providers: [ClassifierService, SalesService],
  exports: [SalesService],
})
export class AgentsModule {}
