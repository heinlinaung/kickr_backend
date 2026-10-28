import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // CORS_EXTRA_ORIGINS is an optional comma-separated list, for local tools
  // served from a different port than the API (the web-push test page runs on
  // :8080). APP_BASE_URL stays the single canonical origin because invite
  // links are built from it, so it must not become a list.
  const extraOrigins = (process.env.CORS_EXTRA_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: [
      process.env.APP_BASE_URL ?? 'http://localhost:3000',
      ...extraOrigins,
    ],
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());

  const config = new DocumentBuilder()
    .setTitle('KicKR API')
    .setDescription('Football event and tournament management platform')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  // Swagger UI orders tags by first appearance in `paths`, which follows Nest's
  // module discovery. SportTypesModule is imported by Users/Groups/Events, so
  // it's discovered early — move its paths to sit right after App config.
  const isSportTypes = (p: string) => p.startsWith('/sport-types');
  const otherPaths = Object.entries(document.paths).filter(([p]) => !isSportTypes(p));
  const sportTypePaths = Object.entries(document.paths).filter(([p]) => isSportTypes(p));
  const lastAppConfig = otherPaths.map(([p]) => p.startsWith('/app-config')).lastIndexOf(true);
  otherPaths.splice(lastAppConfig + 1, 0, ...sportTypePaths);
  document.paths = Object.fromEntries(otherPaths);
  // Method-level @ApiTags is appended to the controller's tag rather than
  // replacing it. Group/event payment endpoints tagged 'Payment & Funds' should
  // live only under that tag, so drop their controller tag.
  for (const ops of Object.values(document.paths)) {
    for (const op of Object.values(ops) as { tags?: string[] }[]) {
      if (op?.tags?.includes('Payment & Funds')) op.tags = ['Payment & Funds'];
    }
  }
  // Basic auth in front of Swagger UI and its JSON (/api-docs-json) so the
  // browser shows a username/password prompt before the docs load.
  const swaggerUser = process.env.SWAGGER_USER ?? 'admin';
  const swaggerPassword = process.env.SWAGGER_PASSWORD ?? '@dmiN123';
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith('/api-docs')) return next();
    const [scheme, encoded] = (req.headers.authorization ?? '').split(' ');
    if (scheme === 'Basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString();
      const sep = decoded.indexOf(':');
      if (decoded.slice(0, sep) === swaggerUser && decoded.slice(sep + 1) === swaggerPassword) {
        return next();
      }
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="KicKR API Docs"');
    res.status(401).send('Authentication required');
  });
  SwaggerModule.setup('api-docs', app, document);

  app.enableShutdownHooks();

  const port = parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port);
  console.log(`KicKR API running on port ${port}`);
  console.log(`Swagger docs at http://localhost:${port}/api-docs`);
}
bootstrap();
