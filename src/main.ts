import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { corsHeaders, isZooCorsPath, parseOrigins, preflightHeaders } from './zoo';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: ['log', 'warn', 'error'],
  });
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: '8kb' });
  app.useBodyParser('urlencoded', { limit: '8kb', extended: false });
  app.enableShutdownHooks();

  const origins = parseOrigins(process.env.ZOO_PANEL_ORIGIN);
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!isZooCorsPath(req.path)) return next();
    const origin = req.headers.origin;
    if (req.method === 'OPTIONS') return res.status(204).set(preflightHeaders(origin, origins)).end();
    res.set(corsHeaders(origin, origins));
    next();
  });

  await app.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? '127.0.0.1');
}
bootstrap();
