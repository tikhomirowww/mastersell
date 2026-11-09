import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CrmService } from '../../crm/crm.service';

const STALE_AFTER_MS = 10 * 60 * 1000;

@Injectable()
export class IdempotencyService {
  constructor(private readonly db: CrmService) {}

  async claim(key: string): Promise<boolean> {
    try {
      await this.db.processedMessage.create({ data: { id: key } });
      return true;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') throw e;
    }

    const reclaimed = await this.db.processedMessage.updateMany({
      where: { id: key, status: 'processing', startedAt: { lt: new Date(Date.now() - STALE_AFTER_MS) } },
      data: { startedAt: new Date() },
    });
    return reclaimed.count === 1;
  }

  async complete(key: string): Promise<void> {
    await this.db.processedMessage.update({
      where: { id: key },
      data: { status: 'done', finishedAt: new Date() },
    });
  }

  async release(key: string): Promise<void> {
    await this.db.processedMessage.deleteMany({ where: { id: key, status: 'processing' } });
  }
}
