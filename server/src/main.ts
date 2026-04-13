import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { WsAdapter } from '@nestjs/platform-ws';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger, ValidationPipe } from '@nestjs/common';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.useWebSocketAdapter(new WsAdapter(app));
  app.useStaticAssets(join(__dirname, '..', 'public'), { prefix: '/public' });
  app.enableCors();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // Swagger — только в dev
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('AI Manager API')
      .setDescription('WhatsApp · Instagram · Voice Sales Agent')
      .setVersion('0.1.0')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
    logger.log(`Swagger: http://localhost:${process.env.PORT ?? 3001}/docs`);
  }

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  logger.log(`AI Manager running on port ${port}`);
}

bootstrap().catch((err) => {
  console.error('Fatal startup error', err);
  process.exit(1);
});
